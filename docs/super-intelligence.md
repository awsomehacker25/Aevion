# Use of Super Intelligence (SI)

NASA Space Apps permits SI tools (chatbots, large language models and similar) and asks teams to say clearly where and how they were used. This is that statement. The same wording is in the README and, in short, inside the app.

## Tool

- **Claude Code**, Anthropic's AI coding assistant, running a Claude large language model (Claude Sonnet 5.5 in the final stretch of the project).

## Where SI was used

| Area | What SI did | What the team did |
| --- | --- | --- |
| **Code** (`apps/web/`, `processing/`) | Wrote and edited parts of the React and TypeScript web app and the Python data scripts, and helped debug them. | Chose the stories, the data, the features and the look; ran and tested the app; made the final decisions. |
| **Data analysis** (`processing/assam/`, `docs/data-sources.md`) | Helped adapt and run the flood-mapping pipeline, build the rain and exposure charts, and read the threshold check against the Assam University map. | Supplied the pipeline and data sources, and decided how results are labeled (every flooded area is an upper bound). |
| **Research and information** | Helped find and summarize documentation and sources for the data products and methods. | Checked the sources and listed them (see the README and `docs/data-sources.md`). |
| **Text** | Helped draft README, documentation and story text. | Edited the text and wrote the project summary in their own words. |
| **Translations** | Machine translated the interface and story text into Spanish, Russian, Hawaiian, Hindi and Assamese. | Nothing yet: no native speaker has reviewed these. The English text is the reference. |

Metadata: every translation file under `apps/web/public/stories/*/i18n/` carries `"machine_translated": true` and a `generated_by` field. The git history records the commits made with Claude Code.

## What SI was not used for

- No SI-generated photographs, videos or audio are in the project.
- No NASA logos, flags, mission identifiers or other NASA branding are used or modified. NASA and ISRO are credited in text only.
- No data values were invented by SI. Every number on the map and in the charts comes from NISAR or the other cited datasets and our own processing of them.

## Responsibility

The team reviewed the project and is responsible for its content. Anything in a non-English language should be treated as unreviewed machine translation.
