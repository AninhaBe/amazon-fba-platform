# Templates de e-mail do Supabase

Templates prontos para colar em **Authentication → Email Templates** no painel do Supabase.

## Confirm signup

### Assunto (Subject)

```text
Confirme seu cadastro no NEXO
```

### Corpo (HTML)

```html
<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, Helvetica, sans-serif; color: #202020;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
      <p style="margin: 0 0 24px; font-size: 20px; line-height: 28px; font-weight: 700;">NEXO</p>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px;">Confirme seu e-mail para concluir seu cadastro.</p>
      <p style="margin: 0 0 24px;">
        <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 20px; background-color: #111111; color: #ffffff; font-size: 16px; line-height: 20px; font-weight: 700; text-decoration: none; border-radius: 6px;">Confirmar e-mail</a>
      </p>
      <p style="margin: 0 0 8px; font-size: 13px; line-height: 20px; color: #5f5f5f;">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin: 0 0 24px; font-size: 13px; line-height: 20px; color: #5f5f5f; word-break: break-all;">{{ .ConfirmationURL }}</p>
      <p style="margin: 0; font-size: 12px; line-height: 18px; color: #777777;">Se você não pediu este e-mail, pode ignorá-lo.</p>
    </div>
  </body>
</html>
```

## Invite user

### Assunto (Subject)

```text
Crie sua senha de acesso ao NEXO
```

### Corpo (HTML)

```html
<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, Helvetica, sans-serif; color: #202020;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
      <p style="margin: 0 0 24px; font-size: 20px; line-height: 28px; font-weight: 700;">NEXO</p>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px;">Sua conta no NEXO está pronta. Crie sua senha para entrar.</p>
      <p style="margin: 0 0 24px;">
        <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 20px; background-color: #111111; color: #ffffff; font-size: 16px; line-height: 20px; font-weight: 700; text-decoration: none; border-radius: 6px;">Criar senha</a>
      </p>
      <p style="margin: 0 0 8px; font-size: 13px; line-height: 20px; color: #5f5f5f;">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin: 0 0 24px; font-size: 13px; line-height: 20px; color: #5f5f5f; word-break: break-all;">{{ .ConfirmationURL }}</p>
      <p style="margin: 0; font-size: 12px; line-height: 18px; color: #777777;">Se você não pediu este e-mail, pode ignorá-lo.</p>
    </div>
  </body>
</html>
```

## Reset password

### Assunto (Subject)

```text
Redefina sua senha do NEXO
```

### Corpo (HTML)

```html
<!doctype html>
<html lang="pt-BR">
  <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, Helvetica, sans-serif; color: #202020;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
      <p style="margin: 0 0 24px; font-size: 20px; line-height: 28px; font-weight: 700;">NEXO</p>
      <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px;">Use o link abaixo para redefinir sua senha. Este link expira.</p>
      <p style="margin: 0 0 24px;">
        <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 20px; background-color: #111111; color: #ffffff; font-size: 16px; line-height: 20px; font-weight: 700; text-decoration: none; border-radius: 6px;">Redefinir senha</a>
      </p>
      <p style="margin: 0 0 8px; font-size: 13px; line-height: 20px; color: #5f5f5f;">Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="margin: 0 0 24px; font-size: 13px; line-height: 20px; color: #5f5f5f; word-break: break-all;">{{ .ConfirmationURL }}</p>
      <p style="margin: 0; font-size: 12px; line-height: 18px; color: #777777;">Se você não pediu este e-mail, pode ignorá-lo.</p>
    </div>
  </body>
</html>
```
