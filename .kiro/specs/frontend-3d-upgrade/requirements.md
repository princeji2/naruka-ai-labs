# Requirements Document

## Introduction

This document specifies the premium 3D, scroll-driven frontend upgrade for the Naruka AI Labs marketing site (Astro 7 project). The upgrade restyles and animates the existing frontend only. All routes, backend, authentication, copy, branding, and data remain unchanged.

The work is delivered in five phases. Each phase ends with a summary (files changed, what was adapted, what could not be done) and then stops until the user replies "go".

1. Phase 1: Foundation (dependencies, Astro React integration, Lenis and ScrollTrigger setup with cleanup, self-hosted Inter Tight font, display type tokens)
2. Phase 2: Shared components (navbar, footer, buttons, cards, background)
3. Phase 3: Hero and home page 3D, plus Astro `ClientRouter` page transitions
4. Phase 4: About, products, contact, sign-in, 404, privacy, terms
5. Phase 5: QA at 360, 768, 1024, and 1440px, reduced motion, and performance

Source-of-truth hierarchy for visuals, fonts, layout, and motion:

- `refrence/GSAP.md` governs site-wide layout, typography, and motion.
- `refrence/hero_section.md` governs the hero only (particle constellation, filled CTA).
- `refrence/background.txt` and `refrence/signin.txt` supply visuals that are ported to Astro components.
- The Contact_Reference governs the /contact page. The user will place a new, legible export (under 2 MB) in `refrence/` before Phase 4.
- `refrence/DESIGN (2).md` through `refrence/DESIGN (6).md` are ignored.
- Colours come only from `refrence/colour theam.png`, represented by the tokens in `src/styles/tokens.css`.
- Fonts: Inter Tight, self-hosted, is used for all text. It replaces Mori (GSAP_Spec) and PPNeueMontreal (Hero_Spec) as the substitute that the GSAP_Spec itself names, and it replaces the existing Inter, JetBrains Mono, and Plus Jakarta Sans.

Reference files are copied first and adapted minimally, with every adaptation reported.

### Decisions resolved by the user (2026-10-10)

| Item | Resolution |
|------|-----------|
| `@types/three` | Approved as a dev dependency. The ambient `declare module 'three'` fallback is removed from the plan. |
| Open_Decision 3 (fonts) | Inter Tight for all text, self-hosted, added in Phase 1. |
| Open_Decision 1 (card shadow) | Cards have no `box-shadow`; hover lift uses `transform` only. |
| Open_Decision 2 (buttons) | Outlined pills everywhere, with one filled CTA in the hero only. Every non-hero filled button becomes an outlined pill, and the primary action uses the gradient-stroke variant. |
| Contact | Left for Phase 4. The user supplies a new export in `refrence/` before then. |
| Font-size cap | The 10-distinct-size cap is lifted for display sizes only (up to 3 new display tokens). It stays for body and UI text. |
| Routing | `ClientRouter` is added in Phase 3, not Phase 1. |
| Assumptions | A1 (motion values from existing tokens in one config file), A9 (thin hero lines in `--secondary` at about 0.25 opacity, reported as an adaptation), and A4 (Node built-in test runner) are confirmed. |

## Glossary

- **Site**: The Naruka AI Labs Astro website in the repository root.
- **Upgrade**: The complete set of frontend changes described in this document.
- **Site_Team**: The AI agent and any developers implementing the Upgrade.
- **Phase**: One of the five delivery stages listed in the Introduction.
- **Phase_Summary**: The report produced at the end of each Phase listing files changed, what was adapted, and what could not be done.
- **Go_Signal**: A user message containing the word "go" that authorises the next Phase to begin.
- **Reference_Folder**: The `refrence/` directory in the repository root (spelling as in the repository).
- **GSAP_Spec**: `refrence/GSAP.md`.
- **Hero_Spec**: `refrence/hero_section.md`.
- **Background_Spec**: `refrence/background.txt`.
- **Signin_Spec**: `refrence/signin.txt`.
- **Contact_Reference**: The /contact visual reference image. Before the user supplies the Contact_Replacement this is `refrence/contact_page.png`; afterwards it is the Contact_Replacement.
- **Contact_Replacement**: A new, legible export of the Contact_Reference, under 2 MB, that the user places in `refrence/` before Phase 4.
- **Ignored_References**: The files `refrence/DESIGN (2).md`, `DESIGN (3).md`, `DESIGN (4).md`, `DESIGN (5).md`, and `DESIGN (6).md`.
- **Colour_Image**: `refrence/colour theam.png`.
- **Token_File**: `src/styles/tokens.css`, holding the palette derived from the Colour_Image.
- **Design_Token**: A CSS custom property defined in the Token_File.
- **Inter_Tight**: The Inter Tight typeface (the substitute that the GSAP_Spec names for Mori), self-hosted as the font for all text.
- **Font_Package**: The npm package that supplies the Inter_Tight font files, `@fontsource-variable/inter-tight` or `@fontsource/inter-tight`, pinned to an exact version.
- **Display_Token**: One of at most 3 font-size tokens added to the Token_File for hero and section headlines, named `--font-size-display-1`, `--font-size-display-2`, and `--font-size-display-3`, each with a matching `--line-height-display-N` and `--letter-spacing-display-N` token.
- **Body_Font_Size**: Any resolved `font-size` value in the Astro_Source that is not a Display_Token.
- **Old_Type_Scale_Check**: The font-size limit of the completed `usability-consistency-fixes` spec (at most 10 distinct sizes in `src/**/*.astro`), stated in its `requirements.md` criterion 1.2, `design.md` Property 2 and its scan snippet, and `tasks.md` task 1.6. No script, test, or CI step enforces it (verified by search of `scripts/`, `.github/`, `.githooks/`, and `package.json`).
- **Hero_CTA**: The single filled call-to-action button in the home page hero.
- **Gradient_Stroke_Pill**: The outlined pill button variant with a 1.5px gradient border, described in the GSAP_Spec, used for the primary action on every page except the Hero_CTA.
- **ClientRouter**: The Astro `ClientRouter` component (view transitions), added to `BaseLayout.astro` in Phase 3 only.
- **Approved_Packages**: `gsap` (including ScrollTrigger), `lenis`, `three`, `@react-three/fiber`, `@react-three/drei`, `@astrojs/react`, and the Font_Package.
- **Approved_Dev_Packages**: `@types/react`, `@types/react-dom`, and `@types/three`.
- **Scroll_Controller**: The module that creates and owns the Lenis instance and connects Lenis to ScrollTrigger.
- **ScrollTrigger_Instance**: Any ScrollTrigger created by the Site.
- **React_Island**: An Astro-hydrated React component used exclusively to host 3D content.
- **Scene_3D**: A Three.js scene rendered through React_Island using `@react-three/fiber` and `@react-three/drei`.
- **Particle_Constellation**: The hero particle field and connecting lines described in the Hero_Spec.
- **Background_Component**: The Astro component that renders the animated site background ported from the Background_Spec.
- **Signin_Page**: The `/signin` route, which is an inert placeholder.
- **Contact_Page**: The `/contact` route.
- **Shared_Components**: Navbar, Footer, Button, Card, Badge, Logo, Input, and Background_Component.
- **Page_Set**: The routes `/`, `/about`, `/products`, `/contact`, `/signin`, `/privacy`, `/terms`, and the 404 page.
- **Protected_Area**: Backend code, API routes, database, authentication, and `.env` files.
- **Reduced_Motion_Mode**: The state in which the media query `prefers-reduced-motion: reduce` matches.
- **Mobile_Viewport**: A viewport narrower than 768px.
- **Test_Widths**: The viewport widths 360px, 768px, 1024px, and 1440px.
- **Layout_Property**: Any of `width`, `height`, `top`, or `left`.
- **Composited_Property**: A CSS property animated without triggering layout, such as `transform` and `opacity`.
- **Open_Decision**: A design choice that the user must confirm before the Site applies it. Open_Decisions 1, 2, and 3 are resolved (see Requirement 16); any new conflict is raised as a new Open_Decision.
- **Typecheck**: Execution of the Astro type check (`astro check`) with strict TypeScript.
- **Build**: Execution of the project build script (`npm run build`).

## Requirements

### Requirement 1: Phase Gating and Reporting

**User Story:** As the project owner, I want each phase to end with a clear report and a hard stop, so that I can review and approve work before the next phase starts.

#### Acceptance Criteria

1. WHEN a Phase finishes, THE Site_Team SHALL produce a Phase_Summary listing the files changed, what was adapted from the Reference_Folder, and what could not be done.
2. WHEN a Phase_Summary has been delivered, THE Site_Team SHALL stop work and wait for a Go_Signal before starting the next Phase.
3. THE Site_Team SHALL execute the Phases in the order Phase 1, Phase 2, Phase 3, Phase 4, Phase 5.
4. WHEN the Phase 1 Phase_Summary is produced, THE Site_Team SHALL state that the Ignored_References were not used.
5. WHEN the Phase 1 Phase_Summary is produced, THE Site_Team SHALL list every package installed, with its version.
6. IF a task cannot be completed within a Phase, THEN THE Site_Team SHALL record the task in that Phase_Summary under "what could not be done" together with the reason.

### Requirement 2: Scope and Protected Boundaries

**User Story:** As the project owner, I want the upgrade limited to visual and motion changes, so that the product's behaviour, content, and identity stay intact.

#### Acceptance Criteria

1. THE Upgrade SHALL preserve every existing route in the Page_Set and every route URL.
2. THE Upgrade SHALL preserve all existing page copy, branding, and data without alteration.
3. THE Upgrade SHALL leave every file in the Protected_Area unmodified.
4. THE Upgrade SHALL leave every file in the Reference_Folder unmodified.
5. THE Upgrade SHALL limit added features to visual and motion features.
6. IF a requested change would modify a Protected_Area file, a route, copy, branding, or data, THEN THE Site_Team SHALL skip that change and report it in the Phase_Summary.

### Requirement 3: Reference Hierarchy and Adaptation

**User Story:** As the project owner, I want the reference files to win over the team's own preferences, so that the result matches the designs I supplied.

#### Acceptance Criteria

1. THE Site SHALL take visuals, fonts, layout, and motion from the Reference_Folder in preference to any other source.
2. THE Site SHALL apply the GSAP_Spec to site-wide layout, typography, and motion.
3. THE Site SHALL apply the Hero_Spec to the home page hero only.
4. THE Site SHALL disregard the Ignored_References during design and implementation.
5. WHEN a reference file is used, THE Site_Team SHALL copy the reference first and adapt the reference by the smallest change necessary.
6. WHEN a reference is adapted, THE Site_Team SHALL record the adaptation and its reason in the Phase_Summary.

### Requirement 4: Colour Tokens

**User Story:** As the project owner, I want every colour drawn from the approved palette, so that the Site stays visually consistent with the colour theme image.

#### Acceptance Criteria

1. THE Site SHALL derive all colours from Design_Tokens defined in the Token_File.
2. THE Site SHALL contain no hard-coded colour value (hex, rgb, rgba, hsl, hsla, or named colour) in any stylesheet, Astro component, React_Island, or script outside the Token_File.
3. WHEN a reference file contains a hard-coded colour, THE Site_Team SHALL replace the colour with the closest Design_Token and report the replacement as an adaptation.
4. WHEN a JavaScript or Three.js object requires a colour value, THE Site SHALL read the value at runtime from the computed Design_Token.
5. IF a required colour has no matching Design_Token, THEN THE Site_Team SHALL add the colour to the Token_File only after confirming the sampled value against the Colour_Image and SHALL report the addition in the Phase_Summary.
6. THE Site SHALL provide a text contrast ratio of at least 4.5:1 against the background behind that text for all body text, using Design_Token colours.
7. THE Site_Team SHALL leave the existing colour tokens in the Token_File unchanged, with two documented exceptions that are not colours: (a) the Display_Tokens added by Requirement 10.8, and (b) the `--font-display`, `--font-body`, and `--font-mono` family stacks, which change to Inter_Tight under Requirement 16.4. Both exceptions SHALL be listed in the Phase 1 Phase_Summary.

### Requirement 5: Dependencies and Integration

**User Story:** As a developer, I want only approved libraries installed and wired correctly, so that the dependency footprint stays small and predictable.

#### Acceptance Criteria

1. THE Site SHALL install only the Approved_Packages as new runtime dependencies, and only the Approved_Dev_Packages as new development dependencies.
2. THE Site SHALL pin each installed Approved_Package and Approved_Dev_Package to an exact version in `package.json`.
3. THE Site SHALL register the `@astrojs/react` integration in `astro.config.mjs`.
4. THE Site SHALL use React_Island components only to host Scene_3D content.
5. THE Site SHALL implement all other Shared_Components and page content as Astro components.
6. THE Site SHALL exclude Tailwind CSS and shadcn/ui.
7. THE Site SHALL exclude framer-motion, with GSAP replacing framer-motion for all motion.
8. IF a package outside the Approved_Packages and the Approved_Dev_Packages (other than the `react` and `react-dom` packages that `@astrojs/react` requires) is needed, THEN THE Site_Team SHALL request approval from the user before installing the package.
9. WHEN the installation completes, THE Site_Team SHALL list every installed package and version in the Phase 1 Phase_Summary.
10. THE Site SHALL satisfy strict TypeScript for `three` imports through `@types/three` (approved by the user on 2026-10-10), with no ambient `declare module 'three'` declaration.

### Requirement 6: Scroll and Motion Infrastructure

**User Story:** As a visitor, I want smooth, reliable scrolling and scroll-driven animation, so that the Site feels premium on every page.

#### Acceptance Criteria

1. THE Scroll_Controller SHALL create a single Lenis instance for the Site.
2. THE Scroll_Controller SHALL register the ScrollTrigger plugin with GSAP once.
3. THE Scroll_Controller SHALL synchronise Lenis scroll updates with ScrollTrigger updates.
4. THE Scroll_Controller SHALL drive the Lenis animation frame from the GSAP ticker.
5. WHEN the page unloads, enters the back/forward cache, or (from Phase 3) the user navigates to another route through the ClientRouter (`astro:before-swap`), THE Scroll_Controller SHALL destroy the Lenis instance, remove the GSAP ticker callback, and kill every ScrollTrigger_Instance.
6. WHEN a component that created a ScrollTrigger_Instance unmounts, THE component SHALL kill that ScrollTrigger_Instance.
7. WHEN the Scroll_Controller initialises twice in succession (React strict mode, a bfcache restore, or repeated route initialisation after `astro:after-swap`), THE Scroll_Controller SHALL leave exactly one active Lenis instance and no duplicate ScrollTrigger_Instances.
8. THE Site SHALL animate only Composited_Properties for GSAP tweens.
9. THE Site SHALL exclude Layout_Property values from every GSAP tween and CSS transition.
10. WHEN the Site animates an element entering the viewport, THE Site SHALL use the easing, duration, and stagger values specified in the GSAP_Spec.

### Requirement 7: Reduced Motion

**User Story:** As a visitor sensitive to motion, I want the Site to respect my system setting, so that I can browse without discomfort.

#### Acceptance Criteria

1. WHILE Reduced_Motion_Mode is active, THE Site SHALL render each Scene_3D as a static frame with no motion.
2. WHILE Reduced_Motion_Mode is active, THE Site SHALL create no pinned ScrollTrigger_Instance and no scrubbed ScrollTrigger_Instance.
3. WHILE Reduced_Motion_Mode is active, THE Site SHALL limit animation to opacity fades.
4. WHILE Reduced_Motion_Mode is active, THE Scroll_Controller SHALL use native browser scrolling in place of Lenis smooth scrolling.
5. WHEN the `prefers-reduced-motion` setting changes while the page is open, THE Site SHALL switch between full-motion and Reduced_Motion_Mode behaviour without a page reload.

### Requirement 8: 3D Performance and Lifecycle

**User Story:** As a visitor, I want 3D content to load lazily and run smoothly, so that the Site stays fast on any device.

#### Acceptance Criteria

1. THE Site SHALL load each Scene_3D lazily, deferring download and hydration of the React_Island until the island approaches the viewport or becomes visible.
2. THE Site SHALL exclude `three`, `@react-three/fiber`, and `@react-three/drei` from the initial JavaScript payload of every route.
3. THE Site SHALL cap the device pixel ratio of each Scene_3D renderer at 2.
4. WHILE a Scene_3D is outside the viewport, THE Site SHALL pause the render loop of that Scene_3D.
5. WHILE the browser tab is hidden, THE Site SHALL pause the render loop of every Scene_3D.
6. WHEN a React_Island unmounts, THE Site SHALL dispose of its geometries, materials, textures, and renderer, and remove its event listeners.
7. WHILE a Scene_3D is running on a desktop viewport, THE Scene_3D SHALL sustain a frame rate of 60 frames per second on a mid-range reference device.
8. WHILE the viewport is a Mobile_Viewport, THE Site SHALL render a simplified or static version of each Scene_3D with reduced particle and geometry counts.
9. IF WebGL is unavailable or context creation fails, THEN THE Site SHALL display a static, token-coloured fallback in place of the Scene_3D.
10. IF a Scene_3D fails to load, THEN THE Site SHALL keep the surrounding page content fully visible and usable.

### Requirement 9: Layout Stability, Accessibility, and Code Quality

**User Story:** As a visitor and a maintainer, I want an accessible, stable, type-safe site, so that the upgrade adds polish without regressions.

#### Acceptance Criteria

1. THE Site SHALL reserve space for each Scene_3D and each animated element so that the cumulative layout shift caused by the Upgrade equals 0.
2. THE Site SHALL produce no console errors or warnings during load, scroll, route navigation, and unmount on every route in the Page_Set.
3. THE Site SHALL make every interactive element operable by keyboard alone.
4. THE Site SHALL display a visible focus indicator on every focusable element, using a Design_Token colour with a contrast ratio of at least 3:1 against its adjacent colours.
5. THE Site SHALL provide a text alternative or `aria-hidden="true"` for every Scene_3D and decorative canvas.
6. THE Site SHALL compile under strict TypeScript with no use of the `any` type and no `@ts-ignore` or `@ts-expect-error` directive.
7. WHEN Typecheck runs, THE Site SHALL report zero errors.
8. WHEN Build runs, THE Site SHALL complete with exit code 0.
9. THE Site SHALL bundle all third-party code and fonts locally and exclude runtime CDN script and font loading.

### Requirement 10: Phase 1 Foundation

**User Story:** As a developer, I want the foundation installed and verified before any visual work, so that later phases build on stable infrastructure.

#### Acceptance Criteria

1. WHEN Phase 1 runs, THE Site_Team SHALL install the Approved_Packages `gsap`, `lenis`, `three`, `@react-three/fiber`, `@react-three/drei`, and `@astrojs/react`.
2. WHEN Phase 1 runs, THE Site_Team SHALL add the React and ReactDOM packages that `@astrojs/react` requires, and SHALL report them in the Phase_Summary.
3. WHEN Phase 1 runs, THE Site_Team SHALL create the Scroll_Controller satisfying Requirements 6 and 7 and wire the Scroll_Controller into `BaseLayout.astro`.
4. WHEN Phase 1 completes, THE Site SHALL pass Typecheck and Build with every route in the Page_Set preserving its routes, copy, and links, and rendering identically to its pre-upgrade appearance except for the typeface change required by Requirement 16.
5. WHEN Phase 1 completes, THE Phase_Summary SHALL report the font outcome: whether Inter_Tight was installed and self-hosted for all text, the files and package version used, whether the old Inter, JetBrains Mono, and Plus Jakarta Sans files were removed or retained (with the reason), the Mori and PPNeueMontreal replacement, and the question whether JetBrains Mono should be kept for code text (Inter_Tight is applied to code text by default).
6. WHEN Phase 1 runs, THE Site_Team SHALL NOT add the ClientRouter. The lifecycle gate built in Phase 1 SHALL already respond to both the page events (`pagehide`, `pageshow`) and the router events (`astro:before-swap`, `astro:after-swap`), and SHALL remain idempotent.
7. WHEN Phase 1 runs, THE Site_Team SHALL install the Font_Package, self-host the Inter_Tight files, and update the font declarations as specified in Requirement 16.4 and 16.5.
8. WHEN Phase 1 runs, THE Site_Team SHALL add the Display_Tokens to the Token_File, and SHALL amend the Old_Type_Scale_Check so that it excludes the Display_Tokens, as specified in Requirement 16.9 and 16.10.
9. WHEN Phase 1 completes, THE Phase_Summary SHALL record the `@types/three` decision (approved, 2026-10-10), the font decision (Inter_Tight, 2026-10-10), and the Display_Token values that were added.

### Requirement 11: Phase 2 Shared Components

**User Story:** As a visitor, I want a consistent navbar, footer, buttons, cards, and background across all pages, so that the Site feels unified.

#### Acceptance Criteria

1. WHEN Phase 2 runs, THE Site_Team SHALL restyle and animate Navbar, Footer, Button, Card, and Background_Component according to the GSAP_Spec.
2. THE Background_Component SHALL reproduce the visual of the Background_Spec using a bundled, typed, Design_Token-driven implementation.
3. THE Background_Component SHALL exclude the particles.js CDN script, all `@ts-ignore` directives, and all hard-coded hex colours present in the Background_Spec.
4. WHEN the Background_Spec is ported, THE Site_Team SHALL report the replacement of the CDN script, the `@ts-ignore` directives, and the hard-coded colours as adaptations in the Phase_Summary.
5. WHEN a Shared_Component is restyled, THE Shared_Component SHALL keep its existing props, link targets, and text content.
6. WHEN the viewport is a Mobile_Viewport, THE Navbar SHALL remain operable by keyboard and touch, with a navigation menu that opens and closes through a button having an accurate `aria-expanded` state.
7. WHEN Phase 2 runs, THE Site_Team SHALL apply the resolved Open_Decisions 1 and 2 without asking the user again, as specified in Requirement 16.2 and 16.3.
8. THE Card component SHALL use no `box-shadow` at rest, on hover, or on focus, with hover lift expressed through `transform` only.
9. THE Button component SHALL render every variant as an outlined pill, SHALL provide the Gradient_Stroke_Pill variant for the primary action, and SHALL permit a filled fill only for the Hero_CTA.
10. WHEN Phase 2 completes, THE Site SHALL contain no filled button outside the home page hero, with every former non-hero `primary` usage converted to the Gradient_Stroke_Pill.

### Requirement 12: Phase 3 Hero and Home Page 3D

**User Story:** As a visitor, I want a striking hero and an immersive scroll-driven home page, so that the Site conveys a premium AI lab.

#### Acceptance Criteria

1. WHEN Phase 3 runs, THE Site_Team SHALL build the home page hero as a Particle_Constellation per the Hero_Spec, with the Hero_CTA as its filled call-to-action button and with all hero text set in Inter_Tight.
2. THE Particle_Constellation SHALL render inside a lazily loaded React_Island using Design_Token colours read at runtime.
3. THE Site SHALL permit a filled button only for the Hero_CTA, with every other button an outlined pill (Requirement 11.9).
4. WHEN the visitor scrolls the home page, THE Site SHALL reveal and transform sections using ScrollTrigger-driven Composited_Property animation per the GSAP_Spec.
5. WHEN the existing HeroPrism component has been superseded by the Particle_Constellation, THE Site_Team SHALL report the removal or retention of HeroPrism in the Phase_Summary.
6. WHILE the viewport is a Mobile_Viewport, THE Particle_Constellation SHALL use a reduced particle count or a static frame.
7. THE home page SHALL retain all existing text content, calls to action, and link targets.
8. WHEN Phase 3 runs, THE Site_Team SHALL add the ClientRouter to `BaseLayout.astro` so that route changes use page transitions.
9. WHEN the ClientRouter is added, THE Site_Team SHALL audit every existing inline script and every script added by the Upgrade (Navbar, Card, Contact, HeroPrism or its replacement, Background_Component, the motion entry, and any other `<script>` in `src/`), and SHALL adapt each so that it cleans up all listeners, observers, animation frames, ScrollTrigger_Instances, and Lenis on `astro:before-swap` and initialises again on `astro:after-swap`.
10. WHEN the ClientRouter navigates between routes, THE Site SHALL leave exactly one active Lenis instance, no duplicate ScrollTrigger_Instances, no duplicate event listeners, and no leaked WebGL context, and SHALL start each page's initialisation exactly once (no duplicate entry from `astro:page-load` on top of `astro:after-swap`).
11. WHEN the ClientRouter is added, THE Site SHALL keep every route URL, every page title, and the `/signin` page's `noindex` directive and unlinked status unchanged.

### Requirement 13: Phase 4 Remaining Pages

**User Story:** As a visitor, I want every other page to share the same premium look and motion, so that the experience is coherent across the Site.

#### Acceptance Criteria

1. WHEN Phase 4 runs, THE Site_Team SHALL restyle and animate the about, products, privacy, terms, and 404 pages per the GSAP_Spec.
2. THE legal pages (privacy and terms) SHALL retain all existing text, with only typography, spacing, and entrance motion changing.
3. WHEN Phase 4 restyles the Signin_Page, THE Site_Team SHALL port the visuals of the Signin_Spec to Astro components.
4. THE Signin_Page SHALL remain an inert placeholder: forms cancel submission, the page keeps its `noindex` directive, and the page remains unlinked from site navigation.
5. WHEN the Signin_Spec is ported, THE Site_Team SHALL replace its `left` transition with a transform-based motion and report the replacement as an adaptation.
6. THE Signin_Page SHALL perform no network request and add no authentication logic.

### Requirement 14: Contact Page Dependency

**User Story:** As the project owner, I want the contact page built from a readable reference, so that the page matches my design without guesswork.

#### Acceptance Criteria

1. IF the Contact_Replacement is missing from the Reference_Folder or cannot be opened when Phase 4 reaches the Contact_Page, THEN THE Site_Team SHALL ask the user for the Contact_Replacement and SHALL not design the Contact_Page layout from assumption. WHEN the file is present and readable, THE Site_Team SHALL proceed without asking.
2. WHILE the Contact_Replacement is absent or unreadable, THE Site_Team SHALL leave the Contact_Page unmodified and record the Contact_Page as incomplete in the Phase_Summary.
3. WHEN Phase 4 reaches the Contact_Page, THE Site_Team SHALL verify that the Contact_Replacement file size is under 2 MB and that the image is legible before using the file.
4. WHEN the Contact_Replacement is verified, THE Site_Team SHALL build the Contact_Page layout from the Contact_Replacement, adapting it minimally, with all existing contact copy and form behaviour preserved.
5. IF the supplied file exceeds 2 MB or remains illegible, THEN THE Site_Team SHALL report the issue and request another export from the user.

### Requirement 15: Phase 5 Quality Assurance

**User Story:** As the project owner, I want verified quality across devices and settings, so that I can ship with confidence.

#### Acceptance Criteria

1. WHEN Phase 5 runs, THE Site_Team SHALL verify every route in the Page_Set at each of the Test_Widths.
2. WHEN Phase 5 runs, THE Site_Team SHALL verify every route in the Page_Set in Reduced_Motion_Mode, confirming no 3D motion, no pinned or scrubbed ScrollTrigger_Instance, and fade-only animation.
3. WHEN Phase 5 runs, THE Site_Team SHALL verify that no horizontal scrolling or overlapping content occurs at any of the Test_Widths.
4. WHEN Phase 5 runs, THE Site_Team SHALL verify that route navigation through the ClientRouter, back/forward navigation, and bfcache restores leave no leaked Lenis instance, ScrollTrigger_Instance, event listener, or WebGL context.
5. WHEN Phase 5 runs, THE Site_Team SHALL verify keyboard operation, visible focus states, and text contrast of at least 4.5:1 on every route.
6. WHEN Phase 5 runs, THE Site_Team SHALL scan the source for hard-coded colours, Layout_Property tweens, `any` types, and `@ts-ignore` directives and confirm zero occurrences.
7. WHEN Phase 5 runs, THE Site_Team SHALL run Typecheck and Build and confirm that both pass.
8. WHEN Phase 5 completes, THE Phase_Summary SHALL report measured frame rate, layout shift, and JavaScript payload figures for the home page, and SHALL state any measurement that could not be taken.

### Requirement 16: Resolved Decisions, Typography, and Type Scale

**User Story:** As the project owner, I want my resolved decisions applied exactly and recorded, so that the Site matches what I approved and no conflict is reopened without cause.

#### Acceptance Criteria

1. THE Site_Team SHALL treat Open_Decisions 1, 2, and 3 and the `@types/three` question as resolved on 2026-10-10, SHALL apply the resolutions in this Requirement without asking the user again, and SHALL raise any further conflict between a reference and the existing Site as a new Open_Decision before changing the Site.
2. THE Card component SHALL use no `box-shadow`, with hover lift expressed through `transform` only (Open_Decision 1, resolved).
3. THE Site SHALL render every button as an outlined pill, with the Hero_CTA as the only filled button, and SHALL convert every non-hero filled `primary` Button usage to the Gradient_Stroke_Pill (Open_Decision 2, resolved).
4. THE Site SHALL set all text, including body, display, and code or monospace text, in Inter_Tight, self-hosted from files served by the Site itself (public files or files bundled through Vite) and installed through the Font_Package at an exact version, with `font-src 'self'` and no CDN, and SHALL point the `--font-display`, `--font-body`, and `--font-mono` tokens at Inter_Tight (Open_Decision 3, resolved).
5. THE Site SHALL keep a preload for the Inter_Tight file used by above-the-fold text, SHALL declare `font-display: swap`, and SHALL declare a size-adjusted fallback font face (using `size-adjust` and the ascent, descent, and line-gap overrides) so that the font swap causes no layout shift.
6. THE Site_Team SHALL remove the Inter, JetBrains Mono, and Plus Jakarta Sans declarations and files only when no other file references them, and IF any reference remains, THEN THE Site_Team SHALL leave those declarations and files in place and report the remaining references in the Phase 1 Phase_Summary.
7. IF Inter_Tight cannot be self-hosted cleanly (for example the package files cannot be served from `'self'`, or the build fails), THEN THE Site_Team SHALL keep the current fonts, SHALL tell the user in the Phase 1 Phase_Summary, and SHALL NOT use a CDN as a fallback.
8. WHEN the Phase 1 Phase_Summary is produced, THE Site_Team SHALL report the font outcome and SHALL ask the user whether JetBrains Mono should be kept for code text, without having applied JetBrains Mono in the meantime.
9. THE Site_Team SHALL add at most 3 Display_Tokens to the Token_File for hero and section headlines, sized large with tight tracking as in the GSAP_Spec, and each Display_Token SHALL have a matching line-height token and letter-spacing token. THE limit of 10 distinct sizes SHALL continue to apply to Body_Font_Size values only.
10. THE Site_Team SHALL amend the Old_Type_Scale_Check, in the `usability-consistency-fixes` spec documents that state it and in any scan added to this Upgrade's `verify-source`, so that it counts distinct sizes with the Display_Tokens excluded (at most 10 Body_Font_Size values, at least 12px each) and checks the Display_Tokens separately (at most 3, all defined in the Token_File, none below 12px).
11. WHEN a decision in this Requirement is first applied, THE Site_Team SHALL record the decision and the date in the next Phase_Summary.
