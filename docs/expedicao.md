# App de Expedição e Separação

App de celular (PWA) para registrar a separação de material do estoque:
lê o QR do **PV**, cronometra a separação, registra o **número de
rastreabilidade** (pedido de compra) de cada item lido e, ao finalizar,
grava o **tempo total** e a **data/hora em que o PV ficou liberado para
produção**.

Arquivo: [`expedicao.html`](../expedicao.html) — página única, sem build.

## Fluxo do operador

1. **Início** → `📷 Ler QR do PV`. A câmera abre; ao reconhecer o código, o
   PV é registrado e **o cronômetro começa a contar**.
2. **`📷 Ler etiqueta do item`** para cada item separado. Cada leitura grava
   o número de rastreabilidade, o horário e o intervalo desde o item anterior.
   Com *leitura contínua* ligada (padrão), a câmera fica aberta para ler
   vários itens em sequência.
3. **`✓ Finalizar separação`** → confirmação com o resumo. Ao confirmar, o app
   grava:
   - duração total da separação (`Fim − Início`);
   - **data e hora de liberação para produção** = momento da finalização;
   - a lista completa de rastreabilidades daquele PV.
4. O registro vai para o **Histórico** e é enviado ao Google Sheets.

Sem câmera ou com etiqueta danificada, `⌨️ Digitar` aceita o código na mão.
Coletores Bluetooth/USB que emulam teclado também funcionam: basta disparar
a leitura com o app aberto — o código é capturado e tratado como um scan.

## Instalar no celular

Abra a URL no Chrome (Android) ou Safari (iOS) e use **Adicionar à tela de
início**. O app roda em tela cheia, funciona **offline** (service worker) e
guarda tudo em `localStorage` — nada se perde se cair o sinal no galpão.

## Configuração

Aba **⚙️ Config**:

| Campo | Para que serve |
|---|---|
| **Operador** | Nome que acompanha cada separação no Sheets. |
| **Bip / Vibrar** | Retorno sonoro e tátil a cada leitura aceita. |
| **Leitura contínua de itens** | Mantém a câmera aberta entre um item e outro. |
| **Bloquear item repetido** | Impede ler duas vezes o mesmo número no mesmo PV. |
| **Regex do PV / do item** | Extrai o número quando o QR traz conteúdo extra. |
| **URL do Apps Script** | Endpoint de gravação no Sheets. Vazio = só local. |
| **Abas** | Nomes das abas de destino (`Separacao` e `Separacao_Itens`). |

### Formato dos códigos

Sem regex, o app já trata os casos comuns:

| Conteúdo do QR | Vira |
|---|---|
| `10233` | `10233` |
| `PV-10233` | `PV-10233` |
| `https://erp.exemplo.com/pv/10233` | `10233` |
| `https://erp.exemplo.com/ped?pv=10233` | `10233` |
| `PV: 10233` | `10233` |

Se o padrão da sua etiqueta for diferente, use a regex — o valor extraído é
o **grupo 1**, ou o match inteiro se não houver grupo. Ex.: `PV[-\s]?(\d+)`.
O campo **"Testar com um código de exemplo"**, logo abaixo, mostra na hora o
que sairia daquele conteúdo.

## Google Sheets

O script de gravação está em [`../apps-script/expedicao.gs`](../apps-script/expedicao.gs).

1. Na planilha, **Extensões › Apps Script**, cole o conteúdo do arquivo.
2. **Implantar › Nova implantação › App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
3. Copie a URL terminada em `/exec` e cole em **Config › URL do Apps Script**.

> O script também responde ao formato antigo `{sheet, row, data}` usado pelo
> dashboard Cacto BI (aba `Acoes`). Ainda assim, compare com o script que já
> está publicado antes de substituí-lo — se o atual tiver alguma regra
> própria, junte as duas partes em vez de sobrescrever.

As abas são criadas sozinhas na primeira gravação.

**Aba `Separacao`** — uma linha por PV:

`ID` · `PV` · `Operador` · `Data` · `Inicio` · `Fim` · `Liberado_Producao` ·
`Duracao_seg` · `Duracao` · `Qtd_Itens` · `Tempo_Medio_Item_seg` · `Status` ·
`Observacao` · `PV_Bruto`

**Aba `Separacao_Itens`** — uma linha por item lido:

`ID_Separacao` · `PV` · `Seq` · `Rastreabilidade` · `Data_Hora` ·
`Desde_Inicio_seg` · `Desde_Item_Anterior_seg` · `Operador` · `Codigo_Bruto`

A gravação é **upsert pelo `ID`**: reenviar a mesma separação atualiza a linha
em vez de duplicar.

### Envio e fila

O envio é assíncrono. Sem rede, o registro fica com a marca **pendente** e
sobe sozinho quando a conexão volta, quando o app é reaberto, ou no toque do
indicador no topo da tela. O contador do topo mostra quantos ainda faltam.

Como rede de segurança, o Histórico exporta **CSV** das duas tabelas e a
Config gera um **backup JSON** completo.

## Indicadores disponíveis

Calculados no próprio app (Início e Histórico, com filtro Hoje / 7 dias / Tudo):
PVs separados, itens lidos, tempo médio por PV, tempo médio por item,
itens/hora e tempo total. No Sheets, `Duracao_seg` e `Tempo_Medio_Item_seg`
já vêm numéricos para dashboards.

## Leitura por câmera

As duas etiquetas — PV e item — são QR Code, e o app lê QR em qualquer
aparelho, sem depender de rede:

- **Chrome/Android** usa a `BarcodeDetector` nativa, mais rápida e que também
  cobre código de barras (Code 128, EAN, ITF…), caso alguma etiqueta mude de
  formato no futuro.
- **iPhone/Safari** e demais navegadores sem `BarcodeDetector` caem no
  **jsQR**, que vem no próprio repositório (`vendor/jsQR.min.js`) — sem CDN,
  então funciona também com o aparelho offline.

Para ser rápido no aparelho, o decodificador analisa ~12 quadros por segundo e
foca no quadrado central da mira; a cada 4 análises varre o quadro inteiro,
para não ignorar um código pouco fora da mira. Em teste com câmera simulada,
a leitura levou ~200–270 ms.

## Limites conhecidos

- A leitura por câmera exige **HTTPS** (ou `localhost`). Em `http://` o
  navegador bloqueia `getUserMedia` — a digitação manual continua funcionando.
- **Micro QR** (o formato reduzido, de um único marcador de canto) não é lido
  pelo jsQR. QR Code comum, de qualquer versão, é lido normalmente — se a
  etiqueta for gerada por um sistema que ofereça as duas opções, mantenha o QR
  padrão.
- Só uma separação fica aberta por vez, por aparelho. Ler o QR de outro PV com
  uma separação em andamento não descarta o trabalho: o app pede para
  finalizar ou cancelar antes.
