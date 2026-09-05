# ReadFlow AI

> **L'utilisateur ne planifie rien. ReadFlow planifie. L'utilisateur lit.**

Application web personnelle (Next.js + TypeScript) : tu importes un livre (PDF, EPUB ou
TXT), ReadFlow l'analyse, tu choisis en combien de jours le terminer, et l'app te montre
chaque jour la partie exacte à lire — avec détection des jours manqués et
réorganisation automatique du planning.

100% local : aucun compte, aucun serveur. Tout est stocké dans le navigateur
(IndexedDB pour les fichiers, localStorage pour l'état).

---

## 1. Lancer le projet

```bash
npm install
npm run dev       # http://localhost:3000
```

```bash
npm run build      # build de production
npm run start       # sert le build
npm run test        # suite de tests automatisés (vitest)
npm run lint         # ESLint
```

## 2. Architecture

```
src/
  app/
    layout.tsx              racine (polices, favicon)
    (main)/                 groupe de routes avec la navigation
      layout.tsx             ← Nav (rail desktop / barre mobile)
      page.tsx                /            Dashboard — session du jour
      library/page.tsx        /library     Bibliothèque
      add/page.tsx             /add         Import + création du plan
      book/[id]/page.tsx       /book/:id    Détail livre + plan complet
      settings/page.tsx        /settings    Réglages, export/import
    read/[id]/
      page.tsx                 /read/:id    Coquille + Suspense (useSearchParams)
      ReaderClient.tsx         Lecteur plein écran (mode normal + Focus Reading)
  components/
    Nav.tsx, BookCard.tsx (+ Cover), EmptyState.tsx, FocusReader.tsx
  lib/
    types.ts                 Modèle de données partagé (Book, Chapter, ReadingPlan,
                              ReadingSession, ReadingProgress, Settings, BookAnalysis…)
    formats/
      pdf.ts                  Extraction PDF réelle (pdf.js) : pages, mots, chapitres
                              via les signets du document
      epub.ts                 Extraction EPUB (JSZip) : container.xml → OPF → spine
                              → chapitres réels dans l'ordre de lecture
      txt.ts                   Détection de chapitres par heuristique de titres
                              ("Chapitre X" / "Chapter X"), fallback : bloc unique
      paginate.ts               Pagination virtuelle (~300 mots/page) partagée par
                              EPUB et TXT, pour exposer le même contrat que le PDF
                              au planificateur (pages numérotées + chapitres bornés)
    analyzeFile.ts             Dispatcher unifié : détecte le format, appelle le bon
                              extracteur, renvoie toujours {title, author, numPages,
                              pages[], chapters[] | null}
    planner.ts                buildInitialPlan() + replan() — bucketing des chapitres
                              respectant les frontières naturelles, réparti sur N jours
    sessionEngine.ts           getDashboardState() — détection missed, priorité de
                              décision (session en cours > manquée > du jour >
                              suivante), déclenche replan() automatiquement
    bookStatus.ts               Statut d'un livre pour la bibliothèque
    storage.ts                 Couche localStorage typée (books/chapters/plans/
                              sessions/progress/settings) + export/import JSON
    db.ts                       Couche IndexedDB (fichiers bruts + texte extrait)
  lib/__tests__/
    planner.test.ts             6 tests : couverture du plan, respect des chapitres,
                              fallback sans chapitres, non-réassignation du contenu
                              déjà lu, préservation/proposition de date cible
    sessionEngine.test.ts       4 tests : 1 jour manqué, plusieurs jours manqués,
                              livre terminé, session du jour sans retard
```

Le contrat central est `{pages: ExtractedPage[], chapters: DetectedChapter[] | null}`.
N'importe quel format qui sait produire cette forme peut être ajouté sans toucher au
planificateur, au moteur de session ni à l'UI.

## 3. Fonctionnalités implémentées

- **Import** PDF / EPUB / TXT par glisser-déposer, avec affichage de la progression
  d'analyse en temps réel (extraction → chapitres → planning)
- **Extraction réelle du contenu** :
  - PDF : texte page par page (pdf.js), chapitres via les signets du document
  - EPUB : parsing du manifeste/spine (JSZip), un chapitre = un fichier du spine
  - TXT : détection de titres de chapitres, fallback bloc unique
- **Planification chapitre-aware** : bucketing qui respecte les frontières de chapitres
  plutôt qu'une division naïve des pages (priorité cohérence > égalité stricte)
- **Dashboard** : session du jour affichée immédiatement, priorité de décision
  session en cours → manquée → du jour → suivante
- **Détection des jours manqués** (1 ou plusieurs), statuts pending/in_progress/
  completed/missed, jamais ignorés
- **Replanification automatique** : redistribue uniquement le contenu restant,
  préserve la progression déjà faite, essaie de conserver la date cible, sinon
  propose clairement une nouvelle date + un rythme quotidien réaliste
- **Lecteur intégré** : mode normal (défilement, mémorisation de position) + **Focus
  Reading** (surlignage progressif mot par mot, rythme naturel selon longueur des
  mots/ponctuation, vitesses 0.5x→2x, play/pause/précédent/suivant)
- **Fin de session** automatique (fin de contenu atteinte ou bouton "Terminer"),
  écran de confirmation avec progression avant/après
- **Livre terminé** à 100%, aucune nouvelle session générée après
- **Bibliothèque** avec statuts (à commencer / en cours / en retard / terminé)
- **Page livre** : plan jour par jour avec statut visuel de chaque session
- **Réglages** : thème clair/sombre, taille du texte, intensité du surlignage,
  vitesse par défaut, export/import JSON, suppression complète des données
- **Persistance locale** : IndexedDB (fichiers + texte extrait) + localStorage
  (livres/plans/sessions/progression/réglages), survit à un refresh/redémarrage
- **Responsive** : rail de navigation desktop, barre mobile en bas, lecteur plein écran

### Non implémenté dans cette passe
- Recherche plein texte dans le lecteur, table des matières interactive
- Couvertures de livre réelles extraites du fichier (placeholder généré à partir du titre)
- Compte / synchronisation multi-appareil (hors périmètre MVP, volontairement)

## 4. Tests effectués

**Automatisés (`npm run test`, 10/10 passent)** :
- Le plan initial couvre l'intégralité du livre sans trou ni chevauchement
- Un chapitre n'est jamais coupé arbitrairement quand une frontière naturelle existe
- Fallback correct en pages simples quand aucune structure de chapitres n'est détectée
- Une session manquée n'est jamais court-circuitée : le dashboard rouvre la session en
  retard plutôt que la session du jour (scénario exact du cahier des charges)
- Plusieurs jours manqués consécutifs sont détectés et regroupés (`missedCount`)
- Le contenu déjà lu (sessions `completed`) n'est jamais réassigné par la replanification
- La date cible est préservée si le rythme résultant reste raisonnable, sinon une
  nouvelle date + un rythme quotidien réaliste sont proposés
- Un livre n'est marqué "terminé" que lorsque toutes les sessions sont `completed`

**Statique** :
- `tsc --noEmit` : 0 erreur
- `next build` : compilation + génération des 7 routes réussies
- `eslint` : 0 erreur (5 avertissements documentés et volontairement conservés — voir
  ci-dessous)

## 5. Problèmes corrigés pendant la boucle de build

- `storage.ts` : `importAllData` tentait d'écrire l'objet `settings` avec la fonction
  générique `write()` prévue pour des tableaux → `TS2345`. Corrigé en routant vers
  `saveSettings()`.
- Import pdf.js worker (`?url`) non typé par TypeScript → ajout d'une déclaration de
  module dédiée (`globals.d.ts`).
- `next/font/google` aurait nécessité de télécharger les polices au moment du build ;
  remplacé par des balises `<link>` classiques vers Google Fonts (chargées côté
  client, comme dans la première itération Vite), pour ne pas dépendre du réseau à la
  compilation.
- Cache de types Next.js obsolète (`.next/types`) référençant l'ancienne page racine
  après restructuration en groupe de routes `(main)` → résolu par un rebuild propre.
- ESLint : types `any` remplacés par des interfaces structurelles minimales pour
  l'outline PDF, `let` → `const` là où le tableau n'était que muté, variable inutilisée
  retirée du composant de fin de session.

## 6. Problèmes restants / avertissements assumés

- ESLint signale 5 avertissements `react-hooks/set-state-in-effect` : ce sont les
  effets qui chargent l'état initial depuis IndexedDB/localStorage au montage de
  chaque page. Comme l'application n'a aucune source de données côté serveur, c'est le
  seul point d'entrée possible pour cet état — la règle a été explicitement passée en
  `warn` avec un commentaire dans `eslint.config.mjs` plutôt que supprimée
  silencieusement.
- L'estimation de durée de lecture utilise une vitesse moyenne fixe (200 mots/minute)
  plutôt qu'une vitesse mesurée par utilisateur — acceptable pour un MVP, améliorable
  en enregistrant `actualDuration` par session (déjà dans le modèle de données, pas
  encore exploité par l'UI).

## 7. Parcours de bout en bout (LOOP 22)

Importer → Analyser → Choisir N jours → Plan généré → Ouvrir Jour 1 → Lire → Fermer →
Revenir → Reprendre exactement à la position → Terminer Jour 1 → Simuler un jour
manqué → Rouvrir l'app → Jour manqué détecté et rouvert (pas le jour du calendrier) →
Reprendre → Planning restant recalculé → Continuer → Livre terminé.

Chaque étape logique de ce parcours (couverture du plan, détection de retard,
non-perte de progression, replanification, achèvement) est couverte par un test
automatisé listé en section 4 ; les étapes purement interactives (clic, défilement,
Focus Reading visuel) ont été vérifiées par lecture de code et par le succès du build
de production — aucun outil de navigateur automatisé n'était disponible dans cet
environnement pour un test end-to-end cliqué.
