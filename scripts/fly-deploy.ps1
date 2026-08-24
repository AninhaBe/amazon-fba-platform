# Deploy do NEXO no Fly.io a partir do Windows, sem depender do WSL.
#
# Por que existe: o flyctl vivia so dentro do WSL, e ligar a VM do WSL exige
# ~1 GB livre. Em 19/08/2026 a maquina ficou com 0,9 GB livres (Chrome com 67
# processos ocupando 5,7 GB) e o WSL nao subia — bloqueando o deploy, que nem
# precisa de recurso local: o build acontece nos servidores do Fly.
#
# Uso (na raiz do repo):   powershell -File scripts/fly-deploy.ps1
#
# ⚠️ NEXT_PUBLIC_* sao substituidas DURANTE o `next build`, entao precisam entrar
# como --build-arg. `fly deploy` cru sobe a imagem com as credenciais VAZIAS — o
# app funciona, o health check passa, e so a tela de login denuncia.
#
# ⚠️ A leitura do .env.local e por linha, NAO por execucao: o arquivo tem valor
# que quebra em varias linhas e qualquer tentativa de "executar" o env morre no
# meio, deixando variaveis do fim indefinidas.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$fly = Join-Path $env:USERPROFILE ".fly\bin\flyctl.exe"
if (-not (Test-Path $fly)) {
  Write-Error "flyctl nao encontrado. Instale com: iwr https://fly.io/install.ps1 -useb | iex"
}

$envFile = ".env.local"
if (-not (Test-Path $envFile)) { Write-Error "$envFile nao encontrado" }

function Read-EnvVar([string]$nome) {
  $linha = Get-Content $envFile | Where-Object { $_ -match "^$nome=" } | Select-Object -First 1
  if (-not $linha) { return "" }
  ($linha -replace "^[^=]+=", "").Trim().Trim('"').Trim("'")
}

$url = Read-EnvVar "NEXT_PUBLIC_SUPABASE_URL"
$key = Read-EnvVar "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
if (-not $url) { Write-Error "NEXT_PUBLIC_SUPABASE_URL vazia em $envFile" }
if (-not $key) { Write-Error "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY vazia em $envFile" }
"ok: URL ($($url.Length) chars) e KEY ($($key.Length) chars) lidas de $envFile"

$version = (& git rev-parse --short HEAD).Trim()
if (-not $version) { Write-Error "Nao foi possivel identificar a versao do NEXO" }
"ok: versao de deploy $version"

# --remote-only: o Fly compila. Sem isto o flyctl usa o Docker local, que come
# RAM e disco desta maquina — exatamente o que se quer evitar aqui.
& $fly deploy --remote-only `
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$url" `
  --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$key" `
  --build-arg "DEPLOYMENT_VERSION=$version"

if ($LASTEXITCODE -ne 0) { Write-Error "deploy falhou (exit $LASTEXITCODE)" }

""
"Lembretes pos-deploy:"
"  - segredos de runtime vao por 'fly secrets set', NAO no fly.toml"
"  - conferir https://nexoaihub.com.br/api/health"
