# LAKIS SOLARWORLD Entwicklung – HACS Beta

Eigenständiger Beta-Kanal für das LAKIS-SOLARWORLD-Dashboard. Dieses Repository
enthält ausschließlich die Entwicklungsintegration und kann parallel zur
Produktionsintegration installiert werden.

## Trennung zur Produktion

| Produktion | Entwicklung / Beta |
| --- | --- |
| `lakis_solarworld` | `lakis_solarworld_development` |
| LAKIS SOLARWORLD Dashboard | LAKIS SOLARWORLD Entwicklung |
| separates Produktionsrepository | dieses Repository |

Die Entwicklungsintegration verwendet eigene Home-Assistant-Pfade für Panel,
WebSocket, statische Frontend-Dateien und hochgeladene Bilder. Sie überschreibt
deshalb keine produktiven Einstellungen, Ressourcen oder Dashboard-Bilder.

## Lizenz

Für die Beta wird unverändert ein gültiger LAKIS SOLARWORLD Pro-Lifetime-Schlüssel
verwendet. Der private Signaturschlüssel ist nicht Teil dieses Repositories.

## Installation über HACS

1. In HACS **Benutzerdefinierte Repositories** öffnen.
2. `99tr6ynprt-collab/lakis-solarworld-dashboard-development` als Kategorie
   **Integration** hinzufügen.
3. **LAKIS SOLARWORLD Entwicklung** installieren.
4. Home Assistant neu starten.
5. Unter **Einstellungen → Geräte & Dienste** die Integration
   **LAKIS SOLARWORLD Entwicklung** hinzufügen und den vorhandenen Lizenzschlüssel
   eingeben.

Die produktive Integration bleibt dabei installiert und unverändert.

## Beta-Releases

Jeder testbare Stand erhält einen GitHub-Release mit einem eindeutigen Tag,
beispielsweise `v1.5.9-beta.1`. Tester sollen bei Fehlermeldungen stets diese
Versionsnummer angeben.
