# SellerCore Personal Information Protection Standard

**Document owner:** 66.106.202 ANA BEATRIZ DE OLIVEIRA (SellerCore)
**Business registration:** CNPJ 66.106.202/0001-20 (Brazil)
**Version:** 1.0
**Effective date:** 2026-08-04
**Approved by:** Ana Beatriz de Oliveira — Developer
**Privacy contact:** contato.anabeatrizoliver@gmail.com

## 1. Purpose and scope

This standard establishes the organizational and technical controls used by SellerCore to protect personal information processed through its multichannel commerce management service. It applies to SellerCore personnel, contractors, production systems, development environments, cloud providers, marketplace integrations, and data received through TikTok Shop APIs.

SellerCore follows the Brazilian General Data Protection Law (LGPD), applicable contractual requirements, marketplace developer terms, and the principles of purpose limitation, necessity, transparency, security, prevention, non-discrimination, and accountability.

## 2. Roles and responsibilities

- The merchant determines the business purposes for processing its customer and order data and generally acts as the data controller.
- SellerCore processes marketplace data on the merchant's documented instructions and generally acts as a data processor/operator.
- SellerCore acts as controller for the minimum account and security data required to operate its own service.
- Ana Beatriz de Oliveira (Developer) is responsible for privacy and information-security oversight and for receiving requests or incident reports at contato.anabeatrizoliver@gmail.com.
- Access to production data is restricted to explicitly authorized personnel with a documented business need.

## 3. Data inventory and permitted purposes

SellerCore may process only the data required for enabled product features:

| Data category | Examples | Permitted purpose |
|---|---|---|
| Account data | User identifier, email, authentication session | Authenticate users and isolate workspaces |
| Seller and shop data | Shop ID, shop name, region, authorization status | Connect and identify the merchant's authorized shop |
| Authorization data | Access token, refresh token, token expiry, shop cipher | Make seller-authorized API requests |
| Catalog and inventory | Product ID, SKU, title, price, stock, warehouse | Present catalog, inventory coverage, and stock alerts |
| Order and fulfillment | Order ID, status, item, shipment and invoice status | Present order operations and fulfillment workflows |
| Buyer information | Only fields returned by authorized APIs and required for fulfillment or Brazilian invoicing | Fulfill orders and comply with applicable invoicing obligations |
| Financial information | Statements, transaction breakdowns, fees and settlement values | Reconciliation, margin calculation, and seller reporting |

SellerCore does not use TikTok Shop data for advertising profiles, data brokerage, unrelated analytics, sale to third parties, or any purpose not requested by the authorizing merchant. Sensitive personal data is not intentionally requested. API scopes are limited to the functions enabled in the service.

## 4. Transparency and authorization

- A merchant must authenticate to SellerCore and explicitly authorize each marketplace connection.
- SellerCore accesses only shops included in the authorization granted by the merchant.
- Authorization credentials are not exposed to browser-side JavaScript or returned by public application endpoints.
- Revoking or disconnecting an integration prevents further API access and removes the stored authorization credentials for that workspace.
- Material changes to processing purposes or data categories require an updated notice and, where required, renewed authorization.

## 5. Access control

- SellerCore uses individual authentication through Supabase Auth; shared production accounts are prohibited.
- Every protected page and API route validates the authenticated identity on the server.
- Marketplace accounts, tokens, product costs, and integration records are keyed by the authenticated workspace identifier.
- Database operations include the workspace identifier in reads, updates, and deletes to prevent cross-tenant access.
- Permissions follow least-privilege and need-to-know principles.
- Administrative access must use strong unique passwords and multi-factor authentication whenever supported.
- Access is removed promptly when a person no longer requires it and is reviewed at least annually.

## 6. Cryptography and secrets management

- Production traffic is transmitted only over HTTPS using TLS 1.2 or higher.
- Marketplace access and refresh tokens are encrypted before persistence using AES-256-GCM with a unique random initialization vector and authentication tag.
- Encryption keys and marketplace secrets are stored as protected server environment variables and are never committed to source control.
- Public browser bundles contain only values explicitly designated as publishable.
- Secrets are rotated after suspected exposure, personnel changes affecting access, or security incidents.
- Production systems fail closed when the required token-encryption key is absent.

## 7. Tenant isolation and production environments

- Each authenticated SellerCore user receives a separate workspace.
- Data queries are scoped server-side to that workspace; client-provided workspace identifiers are not trusted as authorization evidence.
- Legacy unscoped integration records are quarantined and are not exposed through current application routes.
- Development and test credentials must not be used for production customer data.
- Test data should be synthetic or anonymized whenever practical.

## 8. Data minimization, retention, and deletion

- SellerCore requests only the TikTok Shop API scopes required for active SellerCore features.
- TikTok Shop personal information must not be retained merely because it may be useful in the future.
- Authorization tokens are retained only while the merchant keeps the integration connected and are deleted when the integration is disconnected.
- Operational data should be retrieved on demand or retained for the shortest period required to provide the requested feature, accounting, dispute handling, or legal compliance.
- Application logs must not contain passwords, access tokens, refresh tokens, full authorization headers, or unnecessary buyer information.
- When authorization is revoked or the service relationship ends, TikTok Shop personal information is deleted or irreversibly anonymized within 30 days, except where retention is required by law. Any retained legal record is isolated and access-restricted.
- Backups and temporary copies follow the storage provider's documented lifecycle and are not restored for ordinary business use after an approved deletion request.

## 9. Data-subject and merchant requests

Requests for confirmation, access, correction, portability, information about sharing, restriction, objection, revocation, or deletion may be submitted to contato.anabeatrizoliver@gmail.com. SellerCore verifies the requester's identity and works with the relevant merchant/controller where the request concerns marketplace buyer data.

Requests are recorded, evaluated, and answered within the periods required by applicable law. SellerCore does not charge a fee for the ordinary exercise of privacy rights.

## 10. Service providers and international transfers

SellerCore uses a limited set of service providers necessary to operate the service, currently including:

- Supabase, for authentication and PostgreSQL data services;
- Render, for application hosting and encrypted HTTPS delivery;
- Authorized marketplace platforms, including TikTok Shop, as directed by the merchant.

Before adding a provider that will process personal information, SellerCore evaluates its security and privacy terms, limits the data shared, and documents the processing purpose. International transfers are handled under applicable contractual and legal safeguards.

## 11. Secure development and vulnerability management

- Changes are version-controlled and reviewed before production deployment.
- Automated linting, type checks, tests, and production builds are run before release.
- Dependencies are periodically reviewed for known vulnerabilities and security updates are prioritized according to risk.
- Credentials and production data must not be included in source code, issue trackers, screenshots, or test fixtures.
- Security defects are tracked through remediation and critical issues may block a release.
- Independent vulnerability assessment or penetration testing is commissioned when risk, contractual requirements, or material architectural changes justify it.

## 12. Endpoint and workplace security

Personnel with administrative access must:

- use supported operating systems with current security updates;
- use active anti-malware and host firewall protections;
- enable automatic screen locking after no more than 15 minutes of inactivity;
- use unique credentials and multi-factor authentication where available;
- avoid downloading production personal information to unmanaged devices;
- report suspected phishing, credential exposure, malware, or unauthorized access immediately.

## 13. Incident response

Suspected security or privacy incidents are reported immediately to contato.anabeatrizoliver@gmail.com. SellerCore will:

1. record and triage the report;
2. contain the incident and preserve relevant evidence;
3. revoke or rotate affected credentials and tokens;
4. determine the systems, merchants, data categories, and individuals affected;
5. remediate the root cause and safely restore service;
6. notify affected merchants, TikTok Shop, authorities, and data subjects when required by law or contract;
7. document lessons learned and corrective actions.

Incident procedures are reviewed at least annually and after a material incident. Contact and escalation information must remain current.

## 14. Training and confidentiality

All people with access to SellerCore systems or personal information must accept confidentiality obligations and receive privacy and security guidance appropriate to their responsibilities. Training covers credential protection, phishing, least privilege, safe handling, incident reporting, and the prohibition against unauthorized use or disclosure.

## 15. Review and enforcement

This standard is reviewed at least annually and whenever there is a material change to applicable law, TikTok Shop requirements, processing activities, providers, or system architecture. Violations may result in access removal, contractual measures, or other corrective action.

## 16. Approval

By approving this document, management adopts it as SellerCore's operational standard and commits to maintaining the controls described above.

**Approved by:** Ana Beatriz de Oliveira
**Role:** Developer
**Date:** 2026-08-04

---

## Appendix A — Suggested evidence for TikTok Shop review

Attach this policy together with redacted evidence. Do not expose secrets, tokens, database passwords, personal information, or full environment-variable values.

1. Screenshot of the SellerCore login page and individual user accounts.
2. Screenshot showing that two users have separate integration workspaces.
3. Screenshot of the integration screen showing seller-controlled connect/disconnect actions.
4. Redacted screenshot of Render environment-variable names, with all values hidden.
5. Code excerpt showing AES-256-GCM token protection without showing the encryption key.
6. Code excerpt showing database queries restricted by `workspace_id`.
7. HTTPS/TLS validation for `https://sellercore.onrender.com`.
8. Test/build result showing automated security-relevant quality checks.
