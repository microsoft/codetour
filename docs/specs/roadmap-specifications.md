# Spécifications fonctionnelles — CodeTour

## Objet et périmètre

Cet index coordonne les deux spécifications détaillées fournies dans la
conversation du 30 octobre 2026 :

1. Le portage sélectif WebView, Mermaid et Codex, dont la PR #82 est la source
   de vérité et les PR #43, #63 et #30 des références d’implémentation.
2. La distribution de CodeTour en VSIX et CLI autonome, avec ses adaptateurs
   Copilot et Codex.

Les exigences déjà présentes dans `ROADMAP.md` mais absentes de ces deux
spécifications restent suivies séparément. Les autres spécifications du dépôt,
les documents Jira, les registres de validation et les ADR ne sont pas
consolidés ici. Ils ne sont consultés que comme références lorsque nécessaire
pour préserver un comportement existant.

Les exigences du portage sélectif ont été réparties entre les domaines
Mermaid, WebView et intégrations d’agents ci-dessous. La spécification de
distribution fournie dans la conversation est répartie entre les domaines CLI
et intégrations d’agents. Les fichiers sources remplacés ne sont pas conservés
dans ce dossier ; la provenance utile est enregistrée dans cet index et les
spécifications de domaine.

## Domaines fonctionnels

| Domaine | Spécification | Périmètre |
|---|---|---|
| Diagnostics Mermaid | [mermaid-diagnostics.md](mermaid-diagnostics.md) | Grammaire des légendes, diagnostics MCP et validation partagée |
| Lecture et édition VS Code | [vscode-webview-playback-editing.md](vscode-webview-playback-editing.md) | WebView latérale, basculement des surfaces, édition et brouillons |
| Distribution CLI | [standalone-cli-distribution.md](standalone-cli-distribution.md) | Commandes, runtime autonome, packaging et CI |
| Intégrations d’agents | [agent-integrations-copilot-codex.md](agent-integrations-copilot-codex.md) | Installateur commun, Copilot, Codex et configuration MCP |

## Provenance

- **Base fonctionnelle :** branche `feature/specs-77-79-80-integration`,
  PR #82. Les comportements déjà validés sur cette base sont des invariants,
  pas des fonctionnalités à réimplémenter.
- **Références d’implémentation du portage sélectif :** PR #43 (WebView),
  PR #63 (Mermaid) et PR #30 (Codex). Elles ne remplacent pas la PR #82.
- **Distribution CLI et adaptateurs :** spécification fournie le
  30 octobre 2026 pour `maurice30120/codetour`, sur la branche de référence
  `feature/specs-77-79-80-integration`.

Les critères d’acceptation d’origine sont conservés dans les spécifications
de domaine. Les identifiants A–G, E1–F4, A1–D5, B1–C7, G1–G9 et les numéros de
tickets CLI servent à la traçabilité.

## Invariants transverses

1. Les lecteurs autonomes HTML et TermDOM continuent de fonctionner.
2. Les conversations ACP conservent leur contexte par étape, leurs restrictions
   de lecture seule et leurs fallbacks. La lecture d’un Tour ne nécessite pas
   d’agent IA.
3. Les questions déjà enregistrées dans les Tours restent lisibles. Pour les
   Changes Tours critiques, les trois questions suggérées par étape sont
   préparées à la création et ne sont pas régénérées pendant ACP.
4. Le serveur MCP partagé reste l’unique implémentation de
   `create_project_tour` et `create_changes_tour`. Leurs validations,
   comparaisons Git et paramètres existants, dont `fileName`, ne sont pas
   dupliqués ni modifiés par les adaptateurs.
5. Le format `.tour`, le rendu Mermaid, les règles d’images et la comparaison
   Git existants restent compatibles.
6. Les API et chemins propres à VS Code ne sont pas introduits dans les
   lecteurs autonomes.
7. Les agents restent des logiciels indépendants : CodeTour configure leur
   intégration, mais ne les télécharge ni ne les installe.
8. Les distributions VSIX et CLI sont construites depuis les mêmes sources
   métier ; aucune implémentation MCP spécifique à un agent n’est ajoutée.

## Plan de livraison et dépendances

Le graphe ci-dessous conserve les lots et tickets sources, sans inventer de
dates ni de dépendances supplémentaires.

### Portage sélectif

- **Lot 1 — Mermaid (E + F)** : autonome.
- **Lot 2 — WebView et basculement (A + D)**.
- **Lot 3 — Édition et brouillons (B + C)** : dépend du lot 2.
- **Lot 4 — Configuration Codex depuis VS Code (G)** : indépendant des lots 1 à
  3 lorsqu’il n’exige pas de changement dans les mêmes composants.

Chaque lot garde ses tests et son commit distincts. Les PR de référence ne
sont pas fusionnées automatiquement.

### Distribution CLI et intégrations

1. **Ticket 01 — Architecture des intégrations.**
2. **Ticket 02 — Commandes CLI** : dépend du ticket 01.
3. **Ticket 03 — Adaptateur Copilot** : dépend des tickets 01 et 02.
4. **Ticket 04 — Adaptateur Codex** : dépend des tickets 01 et 02 ; peut avancer
   indépendamment du ticket 03.
5. **Ticket 05 — Packaging autonome** : dépend des tickets 03 et 04.
6. **Ticket 06 — CI et publication** : dépend du ticket 05.
7. **Ticket 07 — Validation complète et documentation** : dépend du ticket 06.

La configuration Codex depuis VS Code et celle depuis la CLI sont deux parcours
utilisateur distincts. Elles partagent les règles métier de configuration
lorsque cela est pertinent ; aucune dépendance d’exécution entre ces parcours
n’est présumée.

## Validation de fin

Les spécifications de domaine définissent leurs tests d’acceptation. La
validation globale exécute la suite complète, le build et le packaging VSIX,
puis vérifie la lecture/navigation dans les deux modes VS Code, l’édition, les
Project Tours et Changes Tours, les conversations ACP et questions existantes,
Mermaid et images, les deux outils MCP, la configuration Codex et les lecteurs
autonomes HTML/TermDOM. Les tests du code partagé s’exécutent sous Windows,
macOS et Linux. Les trois échecs CI déjà connus sur la PR #82 sont corrigés ou
isolés explicitement afin qu’ils ne masquent aucune nouvelle régression.

Les artefacts ne sont annoncés comme validés que si les tests et contrôles de
packaging requis réussissent.

La priorité relative de la distribution CLI par rapport aux priorités déjà
classées dans `ROADMAP.md` reste à planifier ; cet index ne lui attribue pas de
date ni de priorité artificielle.
