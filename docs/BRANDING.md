# Hawk Shop branding

Source of truth: [Red Hawk Robotics 2713 — Brand Quick Reference](https://docs.google.com/document/d/1Kz7gYrTyCXmoOkABpw7PLgxPutY9kL-C/edit), September 2026 edition, modified October 24, 2026. Retrieved October 31, 2026 from [0_Templates and Brand Assets](https://drive.google.com/drive/folders/1OKC-SuJtTiGGFBHTh5ZwtVQvNPG2uItB).

This team reference supersedes the template's Hawk Shop-derived palette and Inter typography. The reference's palette table governs when incidental examples disagree, such as its alternate grey and charcoal values.

## Palette

| Token       | Value   | Use                                           |
| ----------- | ------- | --------------------------------------------- |
| True Red    | #BA0C2F | Primary controls, active navigation, emphasis |
| Tone Red    | #C91F43 | Supplied red texture only, never text         |
| Charcoal    | #333333 | Body text and dark panels                     |
| Black       | #000000 | Ink and dark surfaces                         |
| Cool Grey 7 | #A3A19E | Borders and decorative surfaces               |
| Light Grey  | #F2F2F2 | Panels, tables, callouts                      |
| White       | #FFFFFF | Backgrounds; text on red/charcoal             |
| Light Teal  | #5FC7BA | Context rails, icons, chart accents           |

Use shared semantic variables in `src/styles/brand.css`, mapped into Tailwind app tokens and Starlight variables. Never use grey or teal as small text on white. On red, use white text. On dark charcoal, teal is suitable for links. Always pair status colors with words or icons.

## Dark mode

Dark mode follows the operating system setting. Surfaces step up from near-black to Charcoal so panels separate without harsh edges: page `#141414`, cards `#1E1E1E`, muted rows and hover states `#2A2A2A`, borders Charcoal. Body text is Light Grey; secondary text is Cool Grey 7.

Use `--link` for link text and `--emphasis` for small red status text such as "Happening now". In light mode both resolve to True Red. In dark mode `--link` is Light Teal and `--emphasis` is a True Red tint, because True Red text is too dark to read on these surfaces. True Red stays the fill for buttons, badges, rails and active underlines in both themes. Team numbers and other inline links inside text keep the body color, as in light mode. The Starlight docs use the same surface steps.

## Typography

Self-host the Fontsource distributions. Barlow is the heading family; use bold italic capitals for major headings and semibold for subsections/table headers. Barlow Condensed bold italic is reserved for large display titles. Open Sans regular/semibold is the body family. Roboto Mono is for numeric figures only, using `.brand-figures`; code samples keep the documentation system's code font. Do not load fonts from a remote CDN. Keep body copy at a comfortable screen size; the guide's print point sizes are not browser pixels.

## Marks

Use the supplied 2713 numeral mark in this robotics-facing app. `public/brand/2713-red.svg` and `2713-white.svg` are unmodified originals from [0.0_Logos](https://drive.google.com/drive/folders/1lstp4AtVu2wvspR0g0_SdS4uL_KSES3o). Red file ID: `1YA34hNKIWKR4J-Rt0wK9FjGitdmUikTF`. White file ID: `1sFzW5A22MfWiNpc2FnKNkU_dliucKHY3`.

Never typeset, redraw, stretch, rotate, recolor, or add effects to a team mark. For the numeral artwork, use at least 24px cap height with half the artwork height clear on every side. The shared header treatment uses a 24px-high mark with 12px clear space on a transparent background, so it sits directly on the header in both themes. The nearby Hawk Shop name is product text, not part of the official mark. The favicon uses a plain color field rather than squeezing the numeral mark below its minimum size.

## Layout

Use the team's motorsport direction through bold italic headings, crisp rules, and aligned figures. A panel cut, if introduced, uses the documented right-leaning 10-degree angle. Callouts use a Light Grey panel, a 4px rail, and 12/14px padding. Red rails indicate rules/corrections; teal rails provide context. Keep the callout title Barlow semibold and body Open Sans.

Texture must use supplied assets from 0.2_Textures, with Tone Red on True Red; never synthesize a stock pattern. The current app/docs use flat panels and do not require texture. Marks always sit on a flat field.

## Implementation rules

Keep the existing source-owned shadcn primitives in the app and Starlight navigation/search in docs. Check mobile layout, keyboard focus, and readable contrast in both themes after changes. Do not encode meaning through color alone. Keep plain error and recovery copy. Add new components only when a feature needs them.
