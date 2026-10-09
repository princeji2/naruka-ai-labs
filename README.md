# Naruka AI Labs

Official website for **Naruka AI Labs** ([https://orgs.social](https://orgs.social)) — an independent, founder-led AI product studio building practical software products.

---

## Products Overview

### 1. Setu
- **Positioning:** A citizen-centric interoperability gateway enabling consent-based data exchange and verification across digital public service platforms.
- **Origins:** Began as a Smart India Hackathon prototype under Problem Statement **SIH 26129** (*"System Integration and Interoperability Among Government Digital Platforms"*). Currently under active development under Naruka AI Labs.
- **Architecture Note:** Interacts with simulated mock departmental backends using synthetic reference records. Not affiliated with or endorsed by government agencies.

### 2. Field Book
- **Positioning:** A multi-role campus event attendance and verified credentialing platform with QR check-in and server-generated PDF certification.
- **Stack:** React 18, TypeScript, Tailwind CSS, Supabase (Postgres with 67 Row-Level Security policies), Java 17 Spring Boot PDFBox certificate service.
- **Status:** Functional prototype in active development (previously demonstrated at `field-book-delta.vercel.app`).

---

## Website Tech Stack

- **Framework:** [Astro](https://astro.build) (Static output, zero bloated runtime UI frameworks)
- **Language:** TypeScript
- **Styling:** Vanilla CSS with custom design tokens, fluid typography, and glassmorphism utilities
- **Deployment:** Vercel (`https://orgs.social`)
- **CI/CD:** GitHub Actions (Automated install, type-check, and build validation)

---

## Local Development

### Prerequisites
- Node.js `v20+` or `v22+`
- npm `v10+`

### Setup & Scripts

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Run TypeScript & Astro type checking
npm run check

# Build production static output (to dist/)
npm run build

# Preview production build locally
npm run preview
```

---

## Founder & Contact

- **Founder:** Prince Naruka
- **Email:** [naruka@orgs.social](mailto:naruka@orgs.social)
- **LinkedIn:** [linkedin.com/in/prince-naruka-26581236b](https://www.linkedin.com/in/prince-naruka-26581236b/)
- **GitHub:** [github.com/princeji2](https://github.com/princeji2)

---

## License

The code for this website is open source under the **MIT License**.  
*Note: Product codebases, backend services, brand trademarks, and proprietary assets for Setu and Field Book are maintained separately under their respective repositories and licenses.*
