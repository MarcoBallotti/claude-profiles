# Claude Profiles

**I tuoi account Claude, sullo stesso computer.** App open source per gestire profili personali, aziendali e dei clienti su macOS, Windows e Linux.

[Scarica la versione più recente](https://github.com/MarcoBallotti/claude-profiles/releases) · [README completo in inglese](../README.md)

## Come si usa

1. Installa **Claude Profiles** dal pacchetto del tuo sistema operativo.
2. **Personal → Open Desktop** apre il profilo Claude esistente nei percorsi standard.
3. **Work → Open Desktop** apre una finestra separata: accedi con l’account aziendale.
4. La scheda **Code** è disponibile dentro entrambe le finestre Desktop, secondo i rispettivi piani.
5. **Open terminal** avvia invece Claude Code da terminale. Richiede un primo login separato da Desktop.

I profili aggiuntivi conservano dati e configurazioni in cartelle separate. L’app non è un collegamento al sito web e non include una copia di Claude. Claude Desktop e/o Claude Code devono essere già installati.

Puoi creare nuovi profili, assegnare colori, importare cartelle esistenti e copiare selettivamente istruzioni, skill e preferenze. Le credenziali e le conversazioni non vengono copiate. Rimuovere un profilo dall’elenco conserva i dati: lo puoi ripristinare da Settings.

La prima app SwiftUI per Mac viene riconosciuta automaticamente: il registro viene convertito nel nuovo formato, mantenendo i vecchi percorsi e il file originale.

## Sistemi supportati

| Sistema | Pacchetto | Terminale |
| --- | --- | --- |
| macOS 13+ Apple Silicon / Intel | DMG o ZIP | Terminale / zsh |
| Windows 10/11 x64 | Installer o EXE portabile | PowerShell e Claude Code nativo |
| Linux x64 | AppImage o DEB | Terminali comuni, incluso quello di sistema |

Claude Desktop su Linux segue i requisiti della beta ufficiale Anthropic: Ubuntu 22.04+ e Debian 12+. Su altre distribuzioni puoi usare la CLI. Su Windows non viene usata automaticamente un’installazione WSL.

## Login e compatibilità

Se il browser propone l’account sbagliato, apri il link in una finestra privata. Se il login ritorna a un’altra finestra Claude, chiudi temporaneamente le altre istanze durante il primo accesso, senza effettuare logout.

Questa è una **versione di anteprima**: la CI compila e testa il nucleo sui tre sistemi, ma i login interattivi non sono ancora verificati su tutti i canali di installazione. Il supporto multiprofilo Desktop usa un meccanismo non garantito da Anthropic. Le policy aziendali continuano ad applicarsi. I pacchetti non sono notarizzati Apple o firmati con un certificato Windows.

L’app non legge il Portachiavi, non estrae token e non raccoglie telemetria. Desktop e CLI mantengono ciascuno il proprio login.

## Sviluppo

Con Node.js 22.12+:

```sh
npm ci
npm run check
npm test
npm start
npm run dist
```

Licenza [MIT](../LICENSE). Progetto indipendente, non affiliato ad Anthropic.
