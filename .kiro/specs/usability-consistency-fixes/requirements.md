# Requirements Document

## Introduction

This document covers four usability and consistency issues on the Naruka AI Labs Astro site. The numbering 1 to 4 is kept stable so each issue can be traced from requirement through design, tasks and verification.

1. Type scale: pages declare many hardcoded `rem` font sizes next to the shared font-size tokens, so the site renders far more distinct text sizes than the design system defines.
2. Corner radii: a handful of raw pixel and percentage radii sit beside the shared radius tokens, so similar surfaces round differently.
3. Hero badge casing: the badge on the home page hero reads "Founder-Led Product Studio" (26 characters). All-caps with wide tracking makes long labels slow to read.
4. Product tagline casing: the `.card-tagline` text on the home page product cards is forced to uppercase with wide tracking, which makes the long taglines slow to read.

Each requirement below states the root cause, the minimal fix, and how the fix is verified. The site has no test runner, so verification relies on `npm run build`, `npm run check` and searches of the source.

Current state observed in the repository:

- `src/components/Badge.astro` currently applies `text-transform: none` and `letter-spacing: 0.02em` to every badge (commit "use sentence case instead of all-caps for badge labels"). Before that commit, every badge was uppercase with `var(--letter-spacing-wide)`. Neither state varies casing by label length.
- `src/pages/index.astro` styles `.card-tagline` with `text-transform: uppercase` and `letter-spacing: 0.05em`.
- Source files under `src/**/*.astro` contain 22 distinct hardcoded `rem` font sizes (0.72rem to 2rem) and 6 `clamp()` font sizes that use `rem` bounds. Tokens already cover 12px, 14px, 17px, 18px, 19px, 21px, 25.5px, 28px and three fluid steps.
- Source files contain 2px (1 use), 3px (5 uses) and 50% (3 uses) radii next to the `--radius-*` tokens.

## Glossary

- **Site**: The Naruka AI Labs Astro website in this repository.
- **Token_File**: `src/styles/tokens.css`, the file that defines the `--font-size-*` and `--radius-*` custom properties.
- **Font_Size_Token**: Any `--font-size-*` custom property defined in the Token_File, including the fluid steps `--font-size-5xl`, `--font-size-6xl` and `--font-size-7xl`.
- **Radius_Token**: Any `--radius-*` custom property defined in the Token_File.
- **Astro_Source**: All `.astro` files under `src/`, and `src/styles/global.css` for counting purposes.
- **Fixed_Size_Clamp**: A hardcoded `clamp()` font size whose maximum is within 2px of a discrete (non-fluid) Font_Size_Token. It is treated as a fixed size and mapped to that discrete token, because a fluid token would grow the text far beyond the original maximum.
- **Distinct_Font_Size**: A unique resolved font size among all `font-size` declarations in the Astro_Source. Tokens that resolve to the same value, such as `--font-size-base` and `--font-size-md`, count once. Each fluid token counts once.
- **Distinct_Radius**: A unique value among all `border-radius` declarations in the Astro_Source. A shorthand that mixes `0` with one Radius_Token, such as `0 var(--radius-xs) var(--radius-xs) 0`, counts as that Radius_Token.
- **Badge_Component**: `src/components/Badge.astro`, which renders the status and label badges used across the Site.
- **Badge_Label**: The visible text inside a Badge_Component, from the `text` prop or the variant default.
- **Short_Label**: A Badge_Label of 20 characters or fewer, counting spaces and punctuation.
- **Long_Label**: A Badge_Label of more than 20 characters, counting spaces and punctuation.
- **Hero_Badge**: The Badge_Component on the home page hero with the label "Founder-Led Product Studio".
- **Product_Tagline**: A paragraph with class `card-tagline` in `src/pages/index.astro`.
- **True_Circle**: An element whose width equals its height and which is rendered as a circle, such as a dot or an avatar.
- **Build_Command**: `npm run build`.
- **Check_Command**: `npm run check`.

## Requirements

### Requirement 1

**User Story:** As a visitor, I want text on every page to come from one consistent set of sizes, so that headings, body copy and labels look related from page to page.

**Root cause:** Page-level styles declare their own `rem` values (for example 0.72rem, 0.825rem, 0.925rem, 1.35rem) and `clamp()` ranges instead of using the Font_Size_Tokens, so near-duplicate sizes accumulate.

**Minimal fix:** In each `.astro` file, replace every hardcoded `rem` font size with the nearest Font_Size_Token. Replace each `clamp()` font size as follows: if its maximum is within 2px of a discrete Font_Size_Token, treat it as a Fixed_Size_Clamp and use that discrete token (this maps `.hero-lead`, `clamp(1.1rem, 2vw, 1.25rem)`, to `--font-size-2xl`); otherwise use the fluid token whose maximum is closest. Leave the Token_File values unchanged. Shifts of 1 to 2px are acceptable.

#### Acceptance Criteria

1. THE Astro_Source SHALL declare every `font-size` value as a Font_Size_Token reference, with no hardcoded `rem`, `px` or `em` values.
2. THE Astro_Source SHALL contain 10 or fewer Distinct_Font_Sizes.
3. THE Astro_Source SHALL resolve every `font-size` declaration to 12px or larger.
4. WHEN a hardcoded font size is replaced, THE Site SHALL use the Font_Size_Token whose resolved value is closest to the original size, with a shift of 2px or less wherever a Font_Size_Token exists within 2px of the original size.
5. WHEN a hardcoded `clamp()` font size is replaced, THE Site SHALL apply the following rules in order:
   - IF the original maximum is within 2px of a discrete Font_Size_Token, THEN THE Site SHALL treat the `clamp()` as a Fixed_Size_Clamp and use that discrete token, following criterion 4. The `.hero-lead` rule in `src/pages/index.astro`, `clamp(1.1rem, 2vw, 1.25rem)` with a 20px maximum, SHALL use `--font-size-2xl` (21px).
   - OTHERWISE THE Site SHALL use the fluid Font_Size_Token (`--font-size-5xl`, `--font-size-6xl` or `--font-size-7xl`) whose maximum is closest to the original maximum.
6. WHERE two Font_Size_Tokens differ by 2px or less, THE Site SHALL be permitted to use only one of them in order to meet the Distinct_Font_Size limit in criterion 2.
7. THE Token_File SHALL keep the same values for all `--font-size-*` properties as before this change.
8. WHEN the Build_Command is run, THE Site SHALL complete the build with exit code 0.
9. WHEN the Check_Command is run, THE Site SHALL complete the check with exit code 0 and report 0 errors.
10. WHEN the Astro_Source is searched for `font-size:` followed by a numeric `rem`, `px` or `em` value or a `clamp(` expression, THE search SHALL return no matches.

### Requirement 2

**User Story:** As a visitor, I want buttons, cards, tags and panels to share the same corner rounding, so that the interface looks deliberate and consistent.

**Root cause:** Several components use raw radii (`2px` in `Navbar.astro` and `3px` in the home, privacy, terms, Field Book and Setu pages) next to the Radius_Tokens, so small marker and bar shapes round differently from the rest of the Site.

**Minimal fix:** Replace the raw `2px` and `3px` radii with `var(--radius-xs)`. Keep `50%` for each True_Circle. Leave the Token_File values unchanged.

#### Acceptance Criteria

1. THE Astro_Source SHALL declare every `border-radius` value as a Radius_Token reference, the value `50%` on a True_Circle, or the value `0` combined with Radius_Tokens.
2. WHEN a `border-radius` of `2px` or `3px` is found, THE Site SHALL replace the value with `var(--radius-xs)`.
3. WHILE an element is a True_Circle, THE Site SHALL keep its `border-radius` as `50%`.
4. IF a `50%` radius is applied to an element that is not a True_Circle, THEN THE Site SHALL replace the value with the nearest Radius_Token.
5. THE Astro_Source SHALL contain 6 or fewer Distinct_Radii.
6. THE Token_File SHALL keep the same values for all `--radius-*` properties as before this change.
7. WHEN the Build_Command is run, THE Site SHALL complete the build with exit code 0.
8. WHEN the Check_Command is run, THE Site SHALL complete the check with exit code 0 and report 0 errors.
9. WHEN the Astro_Source is searched for `border-radius:` followed by a numeric `px` or `rem` value, THE search SHALL return no matches.

### Requirement 3

**User Story:** As a visitor, I want the hero badge to be easy to read, so that I can understand what Naruka AI Labs is the moment the home page loads.

**Root cause:** The Badge_Component applies one casing and tracking rule to every label regardless of length. Wide-tracked all-caps suits short labels but slows reading of the 26-character Hero_Badge. The latest commit removed uppercase from every badge, which also removed the uppercase treatment from labels that are short enough to use it.

**Minimal fix:** In `Badge.astro`, choose casing from the length of the Badge_Label. Short_Labels render in uppercase with the wide letter spacing. Long_Labels render without uppercase and with the normal badge letter spacing. The change is visual only, so the text in the page markup stays the same.

#### Acceptance Criteria

1. WHEN a Badge_Component renders a Short_Label, THE Badge_Component SHALL display the label in uppercase using `var(--letter-spacing-wide)`.
2. WHEN a Badge_Component renders a Long_Label, THE Badge_Component SHALL display the label without uppercase transformation, using `letter-spacing: 0.02em`.
3. WHEN the home page hero renders the Hero_Badge, THE Hero_Badge SHALL display "Founder-Led Product Studio" in its original mixed case.
4. THE Badge_Component SHALL apply casing through CSS only, so that the text content and accessible name of every Badge_Label stay identical to the `text` prop or the variant default.
5. THE Badge_Component SHALL determine Short_Label or Long_Label status from the rendered Badge_Label, so that the call sites in all pages stay unchanged.
6. THE Badge_Component SHALL keep its existing variants, colors, dot indicator, padding and `font-size: var(--font-size-xs)`.
7. WHEN the Build_Command is run, THE Site SHALL complete the build with exit code 0.
8. WHEN the Check_Command is run, THE Site SHALL complete the check with exit code 0 and report 0 errors.
9. WHEN the built home page HTML is inspected, THE Hero_Badge text SHALL read "Founder-Led Product Studio" and the badge element SHALL carry the long-label styling.

### Requirement 4

**User Story:** As a visitor, I want product card taglines to read as normal sentences, so that I can scan the Setu and Field Book descriptions without effort.

**Root cause:** The `.card-tagline` rule in `src/pages/index.astro` applies `text-transform: uppercase` and `letter-spacing: 0.05em` to taglines of 40 characters or more, so each tagline renders as a long, wide-tracked all-caps line.

**Minimal fix:** Remove `text-transform` and `letter-spacing` from `.card-tagline`, and write the two Product_Taglines in sentence case: "Citizen-centric interoperability gateway" and "Campus event attendance & credentialing ledger". Keep the existing color and font weight.

#### Acceptance Criteria

1. THE `.card-tagline` rule SHALL contain no `text-transform` declaration and no `letter-spacing` declaration.
2. WHEN the home page renders the Setu product card, THE Site SHALL display the Product_Tagline "Citizen-centric interoperability gateway".
3. WHEN the home page renders the Field Book product card, THE Site SHALL display the Product_Tagline "Campus event attendance & credentialing ledger".
4. THE `.card-tagline` rule SHALL keep `color: var(--text-muted)` and `font-weight: 600`.
5. WHEN the Build_Command is run, THE Site SHALL complete the build with exit code 0.
6. WHEN the Check_Command is run, THE Site SHALL complete the check with exit code 0 and report 0 errors.
7. WHEN the Astro_Source is searched for `.card-tagline`, THE search SHALL show no `text-transform: uppercase` in the matching rule.
