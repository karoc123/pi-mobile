# VISION.md — PiMobile Agent Server

## 1. The Core Vision

A complete development studio in your pocket. **PiMobile Agent Server** transforms a local PC (for example a Raspberry Pi) into an autonomous, mobile-first development platform controlled entirely from your smartphone.

While modern AI coding agents offer immense speed, they typically demand heavy desktop IDEs or unmanaged cloud environments. This project breaks that paradigm: it brings the raw efficiency of `pi.dev` (Claude Code, Codex, etc.) straight to your smartphone—securely enclosed within a local WireGuard VPN, combined with absolute human control over every single modified code fragment.

---

## 2. Core Philosophy & Principles

### 100% Control (The "Copilot" Approach)

The agent operates autonomously, but the developer retains ultimate responsibility for the codebase. Every modification is isolated, visually inspected, and approved line by line.

### Offline-First & Data Sovereignty

Your repositories live physically on your own hardware (for example, a Raspberry Pi). The orchestration runs locally via Docker. No third-party cloud services hold the source of truth for your file structures.

### Mobile-First as the Primary Workflow

This system is _not_ just a responsive desktop web UI. Every single interaction, diff analysis, and editing process is radically optimized for one-handed operation on touchscreens (large tap targets, thumb-friendly layouts, and compact unified diffs).

### Cost Transparency Without Leaving the Device

The operator should be able to see what the agent has cost over time without exporting logs or leaving the mobile UI. Cost visibility belongs next to the working session itself: persisted locally, filterable by repository, model, and timeframe, and available from the menu as an operational view.

### Granular Git Staging at Hunk Level

A fine-grained Git workflow right on your phone. Instead of just handling entire files, individual blocks of code (hunks) can be accepted or reverted with a single tap.

---

## 3. The Mobile Workflow (Scenario)

1. **The Interaction (Chat):** While commuting on a train, you type a prompt into your smartphone: _"Add phone number validation to the Auth component and update the tests."_ In the background, `pi.dev` starts working, streaming its thought process live into a mobile chat interface.
2. **Visual Inspection (Diff View):** As soon as the agent pauses, you switch to the Git Dashboard using the bottom navigation bar. You instantly see two modified files.
3. **Fine-Grained Staging (Hunk Revert):** You expand the diff of the test file. The agent wrote three test cases, but one is redundant. You tap **[ Revert ]** next to that specific code hunk—the block vanishes immediately, and the file is reverted on the Pi.
4. **Manual Touch-ups (In-App Editor):** You notice a small typo in an error message. Instead of prompting the agent again, you open the file directly in the app's streamlined text editor on your phone, fix the typo, and hit save. The diff panel refreshes instantly.
5. **Cost Review (Menu -> Costs):** Before continuing, you open the menu-based cost overview. You filter the stored session history down to the current repository and the last 30 days to see how much the recent work consumed.
6. **One-Tap Commit:** Based on the remaining changes, the backend suggests a precise commit message. You tap the large green **[ Commit ]** button right in your thumb's natural reach. The code is clean and checked in.

---

## 4. Target Audience & Use Cases

- **The Mobile Developer:** Efficiently coding on a smartphone while commuting, sitting in a café, or traveling, without having to unwrap a heavy laptop.
- **The Git Purist:** Developers who value AI assistance but reject unmonitored file modifications in their workspace, ensuring they review every line before it commits.
- **The Self-Hoster:** Developers focused on private infrastructure, local Docker environments, and secure network access via WireGuard.
