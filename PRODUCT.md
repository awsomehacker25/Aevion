# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Judges of the NASA Space Apps Challenge and the curious public: non-experts who should understand a story about the Earth changing within seconds. Scientists and analysts are a secondary audience, served by Scientist mode (exact values, provenance, cross-sections, physics checks).

## Product Purpose

Aevion is a NISAR-powered Earth change twin. It shows real NISAR radar measurements of ground motion and surface change (earthquakes, volcanoes, subsidence) as short stories on a 3D satellite map with a timeline of satellite passes. Success: a first-time viewer understands what moved, by how much and why it matters, without reading documentation.

## Positioning

It turns raw NISAR interferometry and radar-brightness products into guided, honest stories, labelling what is measured, derived or illustrative, and keeping an expert layer one click away.

## Operating Context

A full-screen web app: a 3D map with a left information panel, a timeline bar and a navigation dock at the bottom, and a Story / Scientist switch. Built for NASA Space Apps 2026 (Dancing with the SARs); presented live to judges and shared by link.

## Capabilities and Constraints

- Stories load from `apps/web/public/stories/<id>/story.json`; data colours on the map (orange away from the satellite, blue toward it, radar greys) are scientific encodings and must not change.
- Story mode and Scientist mode share one layout.
- Map performance matters (hillshade was removed for speed).
- Data status (placeholder, beta, provisional, validated) must stay visible.

## Brand Commitments

- Name and logo: Aevion (assets in `apps/web/public/logo*`).
- Team credit and challenge credit stay in the app and README.
- Binding visual constraints from the user: a clean, modern, sleek look that does not look vibe-coded; the Steel theme (near-black base `#080c10`, muted blue-grey accent `#b9c8d8`, soft glow) with a light Steel set behind a System / Dark / Light switcher (the user rejected white panels on the dark theme, and the satellite map never changes with the theme). Floating elements (the dock, timeline bar, menus, popovers, inspector and tour cards, map controls) are clean glass: transparency, a blur and a hairline border, not full liquid glass. Reading panels (the side panel) stay about 85 to 92% opaque so long text and charts stay readable. Corner radius: 10px on floating containers, 6px on controls inside them, 4px on small chips and badges. Glow is soft and rare (primary action, active nav item, timeline playhead, at about 20% opacity or less). Inter/Geist type. Blue accent is gone: the accent is a muted blue-grey so a button never reads as a measurement.

## Product Principles

1. Understand in seconds: plain words first, jargon one click away.
2. Be honest about what is measured versus illustrative.
3. The map is the hero; panels stay quiet and out of its way.
4. Science colours are data, never decoration.

## Accessibility & Inclusion

Readable contrast on dark panels, keyboard-reachable controls, and non-colour cues alongside the orange/blue encoding.
