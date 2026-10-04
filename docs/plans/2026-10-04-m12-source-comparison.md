# M12 recipe/scouting comparison

Temporary runs: /tmp/studium-m12-scout-Z0cqjC. The application's real Outliner runs with source recipes and scout_sources. Search/fetch outputs are discovery data; registered evidence remains separate.

## polymers

Current imported sources (parse-health scores):

- lib-openstax-ch-20-introduction-chemistry-2e: **100**, https://openstax.org/books/chemistry-2e/pages/20-introduction
- lib-wikipedia-polymer: **100**, https://en.wikipedia.org/wiki/Polymer
- lib-libretexts-polymer-chemistry-schaller: **93**, https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Polymer_Chemistry_(Schaller)

Proposed sources and reasons (the saved proposal is available in the temporary tree):

- https://openstax.org/books/chemistry-2e/pages/2-1-early-ideas-in-atomic-theory
- https://pslc.ws/macrog/index.htm
## hyderabad-history

Current imported sources (parse-health scores):

- lib-incredibleindia-famous-places-to-explore-in: **100**, https://www.incredibleindia.gov.in/en/telangana/hyderabad
- lib-unesco-the-qutb-shahi-monuments-of-hyderabad: **100**, https://whc.unesco.org/en/tentativelists/5573/
- lib-lse-the-integration-of-the-princely-state: **100**, https://researchonline.lse.ac.uk/id/eprint/32805/
- lib-wikipedia-history-of-hyderabad: **100**, https://en.wikipedia.org/wiki/History_of_Hyderabad
- lib-akdn-india-restoration-in-hyderabad-akdn: **95**, https://www.akdn.org/where-we-work/south-asia/india/cultural-development/restoration-hyderabad
- lib-unesco-monuments-and-forts-of-the-deccan: **100**, https://whc.unesco.org/en/tentativelists/5887/
- lib-cambridge-princely-cities-in-south-asia-c: **100**, https://www.cambridge.org/core/journals/urban-history/article/princely-cities-in-south-asia-c-18501950-themes-and-perspectives/A4317DC6F36D18D2ADA619430977055A
- lib-cambridge-beyond-colonial-urbanism-state: **100**, https://www.cambridge.org/core/journals/urban-history/article/beyond-colonial-urbanism-state-power-global-connections-and-fragmented-land-regimes-in-twentiethcentury-hyderabad-city/08704074F5A5E9F079702F46627401D6
- lib-wikipedia-hyderabad-state: **100**, https://en.wikipedia.org/wiki/Hyderabad_State

Proposed sources and reasons (the saved proposal is available in the temporary tree):

- https://en.wikipedia.org/wiki/Hyderabad
## linear-algebra

Current imported sources (parse-health scores):

- lib-strang-la: **0**, no URL
- lib-en-wikipedia-org-singular-value: **65**, https://en.wikipedia.org/wiki/Singular_value_decomposition
- lib-wikipedia-principal-component-analysis: **65**, https://en.wikipedia.org/wiki/Principal_component_analysis

Proposed sources and reasons (the saved proposal is available in the temporary tree):

- https://numpy.org/doc/stable/reference/routines.linalg.html
- https://www.3blue1brown.com/lessons/linear-transformations
- https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/
- https://www.youtube.com/watch?v=kYB8IZa5AuE

## Provider usage

| Provider | Fresh | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| openai-codex | 142487 | 8165 | 349568 | 0 |

Final scoring correction: SVD baseline is 65. Its linked heading “Truncated singular value decomposition” is not a truncation marker. The audit and re-import tables use the corrected scorer; valid preserved TeX is also excluded from math-damage counts.
