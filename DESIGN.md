---
name: Tandem — Warm Signal
description: Incumbent warm dark call surfaces and inline device settings.
colors:
  bg: "#0c0b09"
  bg-2: "#131210"
  bg-3: "#1a1816"
  surface: "#201d19"
  surface-2: "#272420"
  surface-3: "#302d28"
  border: "rgba(255, 242, 220, 0.055)"
  border-2: "rgba(255, 242, 220, 0.10)"
  border-3: "rgba(255, 242, 220, 0.18)"
  text: "#ede9e1"
  text-2: "#9b9186"
  text-3: "#92897e"
  amber: "#e8a84c"
  coral: "#e07474"
  red: "#ea6868"
  green: "#6bbf7c"
typography:
  display:
    fontFamily: "Fraunces, serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.3px"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  data:
    fontFamily: "DM Mono, monospace"
    fontSize: "13px"
    fontWeight: 500
    letterSpacing: "0.08em"
  device-title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "26px"
  pill: "999px"
spacing:
  form-gap: "8px"
  heading-gap: "12px"
  panel-padding: "16px"
components:
  device-action:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  device-action-hover:
    backgroundColor: "{colors.surface-2}"
  device-select:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "8px"
  footer-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  reply-submit:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.bg}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
---

# Design System: Tandem — Warm Signal

## Overview

**Creative North Star: "Warm Signal"**

Warm Signal is the incumbent identity named in the stylesheet: warm dark surfaces, amber and coral accents, Fraunces branding, and DM Sans interface text. This document records the built call surfaces and their device selector; it does not propose a replacement identity.

**Key Characteristics:**
- Warm tonal layers with restrained borders.
- Serif branding paired with plain interface labels.
- Inline device settings that preserve conversation and call controls.

## Colors

### Primary
Amber identifies the ASL/Deaf role, reply submission, and explicit keyboard focus treatments.

### Secondary
Coral identifies the hearing/speech role. Red marks Leave; green marks connected status.

### Neutral
Near-black warm backgrounds step through progressively lighter surfaces. Cream text carries content; muted warm text carries supporting status. Translucent cream borders divide panels and outline controls. Secondary labels use the lightened warm text token after rendered contrast checks; Leave uses the lightened red token to preserve legibility on its tinted background. Automated checks cover the invitation and active call surfaces, rather than certifying every state or video overlay.

## Typography

Fraunces supplies the brand and incumbent display lettering; DM Sans supplies interface text; DM Mono supplies room codes and data. The call brand uses the display token above. Device headings and labels use 1rem, with weights 600 and 500 respectively; select text also uses 1rem. Conversation content and reply input use 16px. The landing wordmark is larger than the call brand (3.4rem, reduced to 2.6rem at the mobile breakpoint).

## Layout

Desktop calls place the stage beside a 306px sidebar, with a 50px minimum header and 72px controls row. Device settings appear inline at the top of the sidebar, with 16px padding and panel gap, an 8px form gap, and a 12px heading/Close gap.

At widths up to 860px the call becomes a single column and the page grows vertically. Footer controls wrap, with Leave retained. Opening settings enables sidebar scrolling; the conversation log becomes a bounded 160px region so the reply form remains reachable. Desktop heights up to 780px also allow sidebar scrolling. Native selects and device action buttons have a minimum height of 44px.

## Elevation & Depth

Tonal layering and thin warm borders separate the call stage, sidebar, and controls. A subtle fixed grain overlay adds texture. The incumbent shadow scale supports floating video and other raised elements; the inline device panel adds no floating shadow. Exact shadow and motion values are retained in the sidecar. Reduced-motion CSS reduces animation and transition duration to 0.01ms.

## Shapes

Controls use softly rounded corners: device actions and selects use the small radius, footer controls use the medium radius. Pills remain part of the incumbent badge vocabulary. Device settings inherit the sidebar rather than creating a separate card shell.

## Components

- **Devices footer button:** inline SVG sliders with visible Devices text, using the incumbent icon-over-label control. Its expanded state and controlled panel are exposed through ARIA; it is unavailable before permitted room use.
- **Camera & microphone panel:** labelled native Camera and Microphone selects begin with Browser default. Device discovery, pending application, success, and failure use an inline status region. Selecting an option does not apply it; Use selected devices submits the selection.
- **Focus:** opening settings focuses the heading. Close and Escape from within the panel restore focus to Devices when available. Selects, the heading, and device actions use a 2px amber outline with a 3px offset.
- **Conversation:** the existing labelled reply field and explicit Send reply remain part of the same sidebar. Device identifiers stay in the current page; the selector does not persist them.

Sources: `tandem-app/public/style.css`, `deaf.html`, `hearing.html`, and `deviceSettings.js`. Review evidence: `.impeccable/review/devices-desktop.png` and `devices-mobile.png`. The scoped addition passed review without material fixes. Detector coverage was degraded by missing parsers; incumbent font/easing warnings remain. This records the built UI, not whole-app contrast compliance or production readiness.

## Do's and Don'ts

### Do:
- Do reuse the existing warm surfaces, amber focus outline, and font roles.
- Do keep Camera and Microphone labels, native selects, and explicit Use selected devices submission.
- Do preserve access to reply, Send, and Leave when settings are open.

### Don't:
- Don't persist device identifiers beyond the current page.
- Don't turn the inline selector into a modal or silently apply selection changes.
- Don't treat this scoped review as whole-app contrast certification or release approval.
