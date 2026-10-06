# FaceidAcess — MVP

Projeto para reconhecimento facial e liberação de acesso: um Android usa a câmera frontal para propor uma identidade, o servidor local decide se o acesso é autorizado e o resultado aparece no app e no painel. **Não há comando para catraca física.** O reconhecimento facial e o piscar de olhos ainda não foram calibrados nem avaliados como controle de segurança real.

## Requisitos

- Computador que ficará como servidor, com **Node.js 24 ou superior** e npm. O painel e o banco SQLite rodam nele.
- Celular **Android 8 ou superior**, com arquitetura `arm64-v8a` e câmera frontal. Computador e celular precisam estar na mesma rede local, sem isolamento entre dispositivos.
- [mkcert](https://github.com/FiloSottile/mkcert) instalado no computador para gerar um certificado HTTPS de teste confiável no celular.
- Para **compilar** o APK: JDK 17 ou superior, Android SDK com plataforma 34 e Python **3.10**. Android Studio e emulador não são necessários para usar o APK no celular.

Os exemplos principais usam **PowerShell no Windows**; as etapas que precisam de variáveis de ambiente também trazem comandos para Linux/macOS.

O repositório ignora arquivos `*.apk`: quem clonar o projeto deve compilar o aplicativo seguindo este README ou obter um APK anexado a uma versão publicada no GitHub. O APK de teste é uma compilação de depuração para demonstração, não uma versão de distribuição pública.

## Componentes

- `web/`: Next.js 16, TypeScript e SQLite local. Contém painel escuro, login, cadastro e edição de pessoas, autorização, exclusão, pareamento, revogação, ativação e exclusão de aparelhos, códigos de cadastro facial, histórico filtrável, ajustes por anotação, auditoria e exportação CSV. A tela mostra as cinco tentativas e dez ações de auditoria mais recentes; os registros continuam no banco.
- `android/`: projeto Android em Kotlin, CameraX, ML Kit para detectar rostos e Chaquopy/Python com OpenCV e modelo OpenFace para gerar e comparar representações faciais. Traz câmera de catraca em tela cheia e seções separadas de conexão e cadastro facial. Os templates ficam cifrados no aparelho com uma chave do Android Keystore.
- `android/app/src/main/assets/nn4.small2.v1.t7`: modelo OpenFace da Carnegie Mellon University, com [licença Apache 2.0](android/app/src/main/assets/OPENFACE_LICENSE.txt). O checksum MD5 esperado do arquivo é `c95bfd8cc1adf05210e979ff623013b6`.

## Regra de autorização

No painel, cada pessoa tem **Ativa**, **Autorizar acesso** e um **Vencimento** opcional. O acesso começa desautorizado. Para o servidor responder **ACESSO AUTORIZADO**, o rosto deve ser reconhecido no aparelho cadastrado, a pessoa precisa estar ativa, a caixa **Autorizar acesso** precisa estar marcada e, se houver vencimento, a data não pode ter passado. O dia do vencimento ainda é válido; a comparação usa o horário de Brasília no servidor. Uma data vazia deixa a autorização sob controle manual. O motivo **Mensalidade vencida** aparece no histórico e na última tentativa do painel.

Essa regra também vale para bancos SQLite já existentes: a nova coluna de vencimento é criada automaticamente na primeira inicialização do painel atualizado. Pessoas anteriores ficam sem vencimento definido e preservam o estado da autorização manual.

Um administrador pode excluir uma pessoa no painel. O servidor mantém as decisões históricas sem associá-las ao cadastro excluído, revoga imediatamente novas tentativas e remove os vínculos de cadastro facial. O aplicativo sincroniza essa lista ao iniciar a catraca e então apaga localmente os templates excluídos. Se o aparelho não voltar a se conectar, a cópia local permanecerá até sua próxima sincronização ou até os dados do app serem apagados.

Na seção **Aparelhos**, o administrador pode **Revogar** (bloqueio reversível), **Ativar** novamente ou **Excluir**. A exclusão remove o aparelho e invalida seu pareamento e cadastros faciais no servidor. As tentativas anteriores e seu nome de aparelho permanecem no histórico. O servidor não consegue apagar os templates de um celular excluído que não se conecta mais; limpe os dados do aplicativo no Android ao descartar ou reutilizar esse aparelho.

## 1. Iniciar o painel no computador

Clone o projeto e abra um PowerShell na raiz dele. O SQLite é criado automaticamente. Para manter o banco fora da pasta clonada, configure `CATRACA_DB_PATH` com um caminho em **disco local**, fora de OneDrive ou outro diretório sincronizado. Execute `init-admin` somente quando precisar criar uma conta; ele pede e-mail e senha com pelo menos 12 caracteres.

No Windowns:

```powershell

cd web #entra na pasta do serviço web

$env:CATRACA_DB_PATH = Join-Path $env:LOCALAPPDATA 'CatracaLocal\catraca.sqlite' #Important!! rode esse comando caso queira salvar o Banco de dados local no disco local

npm run init-admin #Important!! Cria o banco em /web/data/catraca.sqlite e cria a conta de admin (email e senha). minha recomendação: nao use email pessoal e nem senha pessoal, a aplicação aceita qualquer padrao de email, como: admin@dev.com 


npm install #instala os componentes next para rodar a aplicação

npm run dev #Inicia a aplicação no endereço: https://120.0.0.1:3000
```

Em Linux/macOS:

```bash
cd web #entra na pasta do serviço web

export CATRACA_DB_PATH="$HOME/.local/share/catraca/catraca.sqlite"  #Important!! rode esse comando caso queira salvar o Banco de dados local no disco local

npm run init-admin #Important!! Cria o banco em /web/data/catraca.sqlite e cria a conta de admin (email e senha). minha recomendação: nao use email pessoal e nem senha pessoal, a aplicação aceita qualquer padrao de email, como: admin@dev.com 

npm install #instala os componentes next para rodar a aplicação

npm run dev #Inicia a aplicação no endereço: https://120.0.0.1:3000
```

Mantenha o terminal aberto e acesse `http://127.0.0.1:3000` **no computador**. Para criar depois um operador com acesso somente à consulta, use `npm run init-admin -- operator`. Para execução compilada, use `npm run build` e `npm run start` no lugar de `npm run dev`. Reutilize o **mesmo** `CATRACA_DB_PATH` sempre que iniciar o painel ou administrar contas; sem essa variável, o banco padrão fica em `web/data/catraca.sqlite`.

O Next.js escuta somente em `127.0.0.1`. O celular acessa o painel por um proxy HTTPS na rede local, configurado na próxima etapa.

## 2. Configurar HTTPS para o celular

O aplicativo aceita somente **HTTPS** com certificado confiável. Descubra o IPv4 local do computador (`ipconfig` no Windows; `ip addr` ou `ifconfig` em outros sistemas). Em **outro PowerShell dentro de `web/`**, troque o IP de exemplo abaixo pelo IP do computador e execute:

```powershell
$ip = '192.168.1.10' # substitua pelo IPv4 do computador na rede local
$tlsDir = Join-Path $env:LOCALAPPDATA 'FaceIdAccess'
New-Item -ItemType Directory -Force -Path $tlsDir | Out-Null
mkcert -install
$env:CATRACA_TLS_CERT = Join-Path $tlsDir 'server.pem'
$env:CATRACA_TLS_KEY = Join-Path $tlsDir 'server-key.pem'
mkcert -cert-file $env:CATRACA_TLS_CERT -key-file $env:CATRACA_TLS_KEY $ip
Copy-Item (Join-Path (mkcert -CAROOT) 'rootCA.pem') (Join-Path $tlsDir 'faceidaccess-local-ca.crt')
npm run proxy
```

Em Linux/macOS, em outro terminal dentro de `web/`:

```bash
ip='192.168.1.10' # substitua pelo IPv4 do computador na rede local
tls_dir="$HOME/.local/share/faceidaccess/tls"
mkdir -p "$tls_dir"
mkcert -install
export CATRACA_TLS_CERT="$tls_dir/server.pem"
export CATRACA_TLS_KEY="$tls_dir/server-key.pem"
mkcert -cert-file "$CATRACA_TLS_CERT" -key-file "$CATRACA_TLS_KEY" "$ip"
cp "$(mkcert -CAROOT)/rootCA.pem" "$tls_dir/faceidaccess-local-ca.crt"
npm run proxy
```

O proxy escuta na porta `3443` e encaminha para o painel na porta `3000`. Se o firewall do Windows solicitar permissão para Node.js, libere a rede **privada** para a porta `3443`.

Copie **somente** `faceidaccess-local-ca.crt` para o celular. Nas configurações do Android, procure **Instalar certificado de CA** e selecione o arquivo; os nomes dos menus variam por fabricante. A [documentação do mkcert para dispositivos móveis](https://github.com/FiloSottile/mkcert#mobile-devices) detalha essa instalação. **Nunca copie** `server-key.pem` nem `rootCA-key.pem` para o celular ou para o repositório. Remova a CA do celular quando terminar os testes, caso não precise mais dela.

No navegador do celular, teste `https://SEU-IP:3443` com o IP do computador. Corrija erros de rede ou certificado antes do pareamento. O IP digitado no APK deve corresponder ao IP incluído no certificado. Se o proxy já estiver configurado e funcionando, reutilize-o.

## 3. Obter e instalar o APK no celular

Se uma versão do projeto no GitHub oferecer um APK em **Releases**, baixe-o e compare seu SHA-256 com `dist/SHA256.txt`. Se não houver APK publicado, compile o projeto Android. Para isso, configure `JAVA_HOME` para um JDK 17 ou superior e `ANDROID_HOME` para seu Android SDK com plataforma 34. No Windows, um caminho comum para o SDK é `%LOCALAPPDATA%\Android\Sdk`. Instale Python **3.10** com o launcher `py` e, a partir da raiz do projeto, execute:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21' # ajuste para o JDK instalado
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' # ajuste se o SDK estiver em outro lugar
cd android
$python = (py -3.10 -c "import sys; print(sys.executable)").Trim()
.\gradlew.bat clean assembleDebug "-PcatracaBuildPython=$python"
```

Se for instalar uma nova versão sobre a anterior, aumente `versionCode` e ajuste `versionName` em `android/app/build.gradle.kts` antes de compilar.

Se não tiver o launcher `py`, substitua `$python` pelo caminho completo do `python.exe` da versão 3.10. Em Linux/macOS, após configurar `JAVA_HOME` e `ANDROID_HOME`, use:

```bash
cd android
./gradlew clean assembleDebug "-PcatracaBuildPython=$(command -v python3.10)"
```

O build baixa dependências na primeira execução. Aguarde `BUILD SUCCESSFUL`; não use um APK de uma tentativa interrompida e não pule tarefas Python com `-x`.

O APK compilado fica em `android/app/build/outputs/apk/debug/app-debug.apk`. Antes de instalar, confira se ele inclui as bibliotecas faciais. Ainda dentro de `android/` no PowerShell, execute:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = (Resolve-Path '.\app\build\outputs\apk\debug\app-debug.apk').Path
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
try {
    $entry = $zip.GetEntry('assets/chaquopy/requirements-common.imy')
    if ($null -eq $entry -or $entry.Length -lt 1000000) { throw 'APK sem bibliotecas Python: refaça o build completo.' }
    "Bibliotecas Python presentes: $($entry.Length) bytes"
} finally { $zip.Dispose() }
```

Para guardar **a build validada em `dist/` para testes**, ainda dentro de `android/`, use a mesma versão de `versionName` no nome do arquivo:

```powershell
$version = '0.2.1' # substitua pelo versionName de android/app/build.gradle.kts
$apk = (Resolve-Path '.\app\build\outputs\apk\debug\app-debug.apk').Path
$dist = Join-Path (Resolve-Path '..').Path 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$target = Join-Path $dist "faceIdAccess-v$version-teste.apk"
Copy-Item -LiteralPath $apk -Destination $target -Force
Get-FileHash -Algorithm SHA256 -LiteralPath $target
```


Para instalar em um **celular físico**:

### Opção 1

1. Conecte o celular ao computador por USB e escolha **Transferência de arquivos** na notificação do Android.
2. Copie o APK obtido ou compilado para a pasta **Downloads** do celular. Não é necessário Android Studio, ADB nem emulador no celular.
3. No celular, abra **Arquivos/Meus Arquivos**, toque no APK e escolha **Instalar**. Se solicitado, permita **Instalar apps desconhecidos** para o aplicativo de arquivos usado. Ao abrir o app, conceda acesso à câmera.

### Opção 2

1. Suba esse APK no na sua conta do drive pelo computador
2. No celular,apos acessar a mesma conta no drive, baixe esse APK e abra **Arquivos/Downloads**, toque no APK e escolha **Instalar**. Se solicitado, permita **Instalar apps desconhecidos** para o aplicativo de arquivos usado. Ao abrir o app, conceda acesso à câmera.


## 4. Parear e testar a catraca simulada

1. Entre no painel, cadastre uma pessoa e adicione um aparelho. O painel exibirá um código de pareamento temporário.
2. No aplicativo, abra **Conexão**, informe `https://SEU-IP:3443`, toque em **Salvar conexão**, digite o código de pareamento e toque em **Parear aparelho**.
3. No painel, selecione a pessoa e o aparelho e gere um código de cadastro facial. Confirme a identidade da pessoa antes dessa etapa. No app, abra **Cadastro**, informe o código, enquadre um único rosto e toque em **Cadastrar rosto**.
4. No painel, marque **Autorizar acesso**. Para simular uma mensalidade válida, defina **Vencimento** para hoje ou uma data futura; o campo também pode ficar vazio.
5. No app, abra **Catraca** e toque em **Iniciar catraca em tela cheia**. Após a sincronização, olhe de frente para a câmera e pisque. O celular exibe **ACESSO AUTORIZADO** e o painel registra a tentativa. Toque em **Reduzir e parar** para interromper a leitura. Para repetir, afaste-se da câmera e volte.
6. Para testar uma negativa, altere o vencimento para ontem ou desmarque **Autorizar acesso**. Faça outra tentativa: o celular exibe **ACESSO NEGADO** e o painel mostra o motivo.

O painel atualiza a última tentativa a cada três segundos. Ele mostra apenas as **cinco tentativas** e **dez ações de auditoria** mais recentes; o CSV continua disponível para exportar o histórico completo de tentativas. Se uma pessoa for excluída no painel, o servidor nega novas tentativas imediatamente, e o app remove seu rosto local quando a catraca for iniciada novamente com o servidor disponível.

Se a pessoa estiver inativa, sem permissão, com mensalidade vencida, não cadastrada no aparelho ou não for reconhecida, o servidor nega. Se o servidor não responder, o celular não mostra autorização.

## Zerar o sistema local para começar de novo

Isto apaga **administradores, pessoas, aparelhos, pareamentos, tentativas e auditoria** do banco escolhido. Se quiser guardar uma cópia, execute `npm run backup` em `web/` com o mesmo `CATRACA_DB_PATH` antes de prosseguir. Pare `npm run dev` ou `npm run start` **e** `npm run proxy` antes de excluir os arquivos SQLite.

No PowerShell, entre em `web/` e indique o **mesmo caminho do banco usado na etapa 1**. O exemplo abaixo corresponde ao caminho recomendado neste README; se você configurou outro `CATRACA_DB_PATH`, substitua `$dbPath` pelo caminho real. Confira o caminho impresso antes de executar o bloco de remoção:

```powershell
cd web
$dbPath = Join-Path $env:LOCALAPPDATA 'CatracaLocal\catraca.sqlite'
Write-Host "Banco que será apagado: $dbPath"
```

Depois de conferir o caminho:

```powershell
foreach ($suffix in @('', '-wal', '-shm')) {
    $file = "$dbPath$suffix"
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
}
```

Se você usou o banco padrão **sem** `CATRACA_DB_PATH`, use `$dbPath = Join-Path (Get-Location).Path 'data\catraca.sqlite'` dentro de `web/` antes do `foreach`. Em Linux/macOS, com o caminho da etapa 1:

```bash
cd web
db="$HOME/.local/share/catraca/catraca.sqlite"
printf 'Banco que será apagado: %s\n' "$db"
```

Depois de conferir o caminho:

```bash
rm -f -- "$db" "$db-wal" "$db-shm"
```

Depois, inicie um banco novo e crie outra conta administrativa, usando o mesmo caminho configurado anteriormente:

```powershell
$env:CATRACA_DB_PATH = $dbPath
npm run init-admin
npm run dev
```

No Linux/macOS, execute `export CATRACA_DB_PATH="$db"` antes de `npm run init-admin` e `npm run dev`. Os backups existentes **não** são apagados por esses comandos. Para zerar também o celular, use **Configurações do Android → Apps → Catraca → Armazenamento → Limpar dados** (o nome do menu varia por fabricante) ou desinstale o aplicativo; isso remove o pareamento e os templates faciais locais. Depois, cadastre as pessoas, crie um novo aparelho no painel, pareie e faça o cadastro facial novamente. O certificado HTTPS pode ser reutilizado se ainda estiver válido para o IP do computador.

## Verificação e limites

O teste `node scripts/smoke.mjs`, executado dentro de `web/` após `npm run build`, verifica migração do banco e do histórico, login, pareamento, cadastro, autorização manual, vencimento, limites de exibição, exclusão de pessoas e aparelhos, sincronização e revogação com um banco de teste isolado. `npm run typecheck` e `npm run build` verificam o painel. Use `npm run backup` dentro de `web/` para criar uma cópia consistente do SQLite; o arquivo gerado ainda precisa ser guardado em mídia cifrada e ter a restauração testada. A nova interface Android precisa ser conferida no aparelho físico; o servidor não consegue verificar se um APK comprometido informou um rosto verdadeiro.

Este MVP usa **uma foto para o cadastro** e um limiar facial de demonstração; ambos exigem avaliação com pessoas e condições reais. O piscar de olhos é apenas um desafio simples e pode ser enganado por vídeo. Não use a saída para liberar uma porta física, registrar ponto legal ou negar um direito até validar precisão, prova de presença, regras de autorização e privacidade. O modo atual suporta um aparelho e exige conexão para cada tentativa.

Ficam para a próxima etapa o registro manual excepcional, uma política completa de retenção, backup automatizado, vários aparelhos, operação offline e testes de fraude. Os ajustes disponíveis agora adicionam uma anotação auditada; não alteram a decisão original. O documento de plano permanece como referência para essas etapas.
