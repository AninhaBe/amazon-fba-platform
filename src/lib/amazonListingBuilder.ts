import { currentAccount } from "./accountContext";
import { getItemInfo } from "./catalog";
import { defaultMarketplaceId, spapiFetch } from "./spapi";

const MARKETPLACE_ID = defaultMarketplaceId();
const LOCALE = "pt_BR";

type JsonObject = Record<string, unknown>;

export interface ListingIssue {
  code: string;
  message: string;
  severity: "ERROR" | "WARNING" | "INFO";
  attributeNames: string[];
}

export interface ExistingOfferInput {
  kind: "existing";
  asin: string;
  productType: string;
  sku: string;
  price: number;
  condition: string;
  fulfillment: "AMAZON_NA" | "DEFAULT";
  quantity?: number;
}

export interface NewListingInput {
  kind: "new";
  productType: string;
  sku: string;
  title: string;
  brand: string;
  manufacturer?: string;
  description: string;
  bulletPoints: string[];
  countryOfOrigin: string;
  imageUrl: string;
  externalId?: string;
  externalIdType?: "ean" | "upc" | "gtin";
  identifierExemption?: boolean;
  price?: number;
  condition: string;
  fulfillment?: "AMAZON_NA" | "DEFAULT";
  quantity?: number;
  relationship?: "standalone" | "parent" | "child";
  parentSku?: string;
  variationTheme?: string;
  variationValue?: number;
}

export type ListingBuilderInput = ExistingOfferInput | NewListingInput;

interface ProductTypeDefinitionResponse {
  metaSchema?: { link?: { resource?: string } };
  schema?: { link?: { resource?: string } };
  productType?: string;
  productTypeVersion?: { version?: string };
  requirements?: string;
}

interface ProductTypeSchema {
  required?: string[];
  properties?: Record<string, {
    title?: string;
    description?: string;
    examples?: unknown[];
    items?: { properties?: Record<string, { enum?: string[]; enumNames?: string[] }> };
  }>;
}

interface CatalogProductTypesResponse {
  asin?: string;
  productTypes?: { marketplaceId?: string; productType?: string }[];
}

interface ProductTypeSearchResponse {
  productTypes?: Array<{ name?: string; displayName?: string; marketplaceIds?: string[] }>;
}

interface ListingSubmissionResponse {
  sku?: string;
  status?: string;
  submissionId?: string;
  issues?: Array<{
    code?: string;
    message?: string;
    severity?: string;
    attributeNames?: string[];
  }>;
}

function localized(value: string) {
  return { value, language_tag: LOCALE, marketplace_id: MARKETPLACE_ID };
}

function marketplaceValue(value: string | number | boolean) {
  return { value, marketplace_id: MARKETPLACE_ID };
}

function offer(price: number) {
  return [{
    audience: "ALL",
    currency: "BRL",
    marketplace_id: MARKETPLACE_ID,
    our_price: [{ schedule: [{ value_with_tax: price }] }],
  }];
}

function fulfillment(channel: "AMAZON_NA" | "DEFAULT", quantity?: number) {
  return [{
    fulfillment_channel_code: channel,
    ...(channel === "DEFAULT" ? { quantity: Math.max(0, Number(quantity) || 0) } : {}),
  }];
}

export function buildListingAttributes(input: ListingBuilderInput): JsonObject {
  if (input.kind === "existing") {
    return {
      condition_type: [marketplaceValue(input.condition)],
      merchant_suggested_asin: [marketplaceValue(input.asin.toUpperCase())],
      purchasable_offer: offer(input.price),
      fulfillment_availability: fulfillment(input.fulfillment, input.quantity),
    };
  }

  const attributes: JsonObject = {
    item_name: [localized(input.title)],
    brand: [localized(input.brand)],
    product_description: [localized(input.description)],
    bullet_point: input.bulletPoints.filter(Boolean).map(localized),
    country_of_origin: [marketplaceValue(input.countryOfOrigin)],
    supplier_declared_dg_hz_regulation: [marketplaceValue("not_applicable")],
    condition_type: [marketplaceValue(input.condition)],
    main_product_image_locator: [{ media_location: input.imageUrl, marketplace_id: MARKETPLACE_ID }],
  };

  if (input.manufacturer) attributes.manufacturer = [localized(input.manufacturer)];
  if (input.identifierExemption) {
    attributes.supplier_declared_has_product_identifier_exemption = [marketplaceValue(true)];
  } else if (input.externalId && input.externalIdType) {
    attributes.externally_assigned_product_identifier = [{
      type: input.externalIdType,
      value: input.externalId,
      marketplace_id: MARKETPLACE_ID,
    }];
  }

  if (input.relationship !== "parent" && input.price) {
    attributes.purchasable_offer = offer(input.price);
    attributes.fulfillment_availability = fulfillment(input.fulfillment || "DEFAULT", input.quantity);
  }

  if (input.relationship === "parent") {
    attributes.parentage_level = [marketplaceValue("parent")];
  }

  if (input.relationship === "child") {
    attributes.parentage_level = [marketplaceValue("child")];
    attributes.child_parent_sku_relationship = [{
      child_relationship_type: "variation",
      parent_sku: input.parentSku,
      marketplace_id: MARKETPLACE_ID,
    }];
  }

  if (input.relationship !== "standalone" && input.variationTheme) {
    attributes.variation_theme = [{ name: input.variationTheme, marketplace_id: MARKETPLACE_ID }];
  }
  if (input.variationValue !== undefined) {
    attributes.number_of_items = [marketplaceValue(input.variationValue)];
  }

  return attributes;
}

function sellerId(): string {
  const value = currentAccount()?.sellerId;
  if (!value) throw new Error("Conta Amazon não selecionada.");
  return value;
}

export async function inspectAsin(asin: string) {
  const normalized = asin.trim().toUpperCase();
  const [item, catalog] = await Promise.all([
    getItemInfo(normalized),
    spapiFetch<CatalogProductTypesResponse>(`/catalog/2022-04-01/items/${encodeURIComponent(normalized)}`, {
      query: { marketplaceIds: MARKETPLACE_ID, includedData: "productTypes" },
    }),
  ]);

  const productType = catalog.productTypes?.find((entry) => entry.marketplaceId === MARKETPLACE_ID)?.productType
    || catalog.productTypes?.[0]?.productType;
  if (!productType) throw new Error("A Amazon não informou o tipo desse produto.");

  const restrictions = await spapiFetch<{ restrictions?: unknown[] }>("/listings/2021-08-01/restrictions", {
    query: {
      asin: normalized,
      sellerId: sellerId(),
      marketplaceIds: MARKETPLACE_ID,
      conditionType: "new_new",
      reasonLocale: "pt_BR",
    },
  });

  return { item, productType, restrictions: restrictions.restrictions || [] };
}

export async function inspectProductType(productType: string) {
  const normalized = productType.trim().toUpperCase();
  const definition = await spapiFetch<ProductTypeDefinitionResponse>(
    `/definitions/2020-09-01/productTypes/${encodeURIComponent(normalized)}`,
    {
      query: {
        marketplaceIds: MARKETPLACE_ID,
        requirements: "LISTING",
        requirementsEnforced: "ENFORCED",
        locale: "pt_BR",
        sellerId: sellerId(),
      },
    }
  );

  const schemaUrl = definition.schema?.link?.resource;
  if (!schemaUrl) throw new Error("A Amazon não retornou os requisitos desta categoria.");
  const response = await fetch(schemaUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar os requisitos desta categoria.");
  const schema = await response.json() as ProductTypeSchema;
  const required = schema.required || [];
  const fields = required.map((name) => {
    const property = schema.properties?.[name];
    return {
      name,
      title: property?.title || name.replaceAll("_", " "),
      description: property?.description || "",
    };
  });
  const variationProperty = schema.properties?.variation_theme?.items?.properties?.name;
  const variationThemes = variationProperty?.enum?.map((value, index) => ({
    value,
    label: variationProperty.enumNames?.[index] || value.replaceAll("_", " "),
  })) || [];

  return {
    productType: normalized,
    version: definition.productTypeVersion?.version,
    required: fields,
    variationThemes,
  };
}

export async function searchProductTypes(keywords: string) {
  const response = await spapiFetch<ProductTypeSearchResponse>("/definitions/2020-09-01/productTypes", {
    query: { marketplaceIds: MARKETPLACE_ID, keywords: keywords.trim(), locale: "pt_BR" },
  });
  return (response.productTypes || []).filter((item) => item.name).slice(0, 12).map((item) => ({
    name: item.name as string,
    displayName: item.displayName || item.name,
  }));
}

export async function submitListing(input: ListingBuilderInput, preview: boolean) {
  const attributes = buildListingAttributes(input);
  const result = await spapiFetch<ListingSubmissionResponse>(
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId())}/${encodeURIComponent(input.sku)}`,
    {
      method: "PUT",
      query: {
        marketplaceIds: MARKETPLACE_ID,
        issueLocale: "pt_BR",
        ...(preview ? { mode: "VALIDATION_PREVIEW" } : {}),
      },
      body: {
        productType: input.productType,
        requirements: input.kind === "existing" ? "LISTING_OFFER_ONLY" : "LISTING",
        attributes,
      },
    }
  );

  const issues: ListingIssue[] = (result.issues || []).map((issue) => ({
    code: issue.code || "AMAZON",
    message: issue.message || "A Amazon encontrou um problema neste anúncio.",
    severity: issue.severity === "WARNING" || issue.severity === "INFO" ? issue.severity : "ERROR",
    attributeNames: issue.attributeNames || [],
  }));

  return {
    sku: result.sku || input.sku,
    status: result.status || (preview ? "VALID" : "ACCEPTED"),
    submissionId: result.submissionId,
    preview,
    issues,
    canPublish: result.status !== "INVALID" && !issues.some((issue) => issue.severity === "ERROR"),
  };
}
