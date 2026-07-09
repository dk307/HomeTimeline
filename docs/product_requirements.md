# Camera Event Manager - Product Requirements

## Overview

### Vision

Camera Event Manager is a lightweight, self-hosted web application for managing event-based security recordings.

Unlike a traditional NVR, this application does **not** perform continuous recording or motion detection. Recording decisions are made by external systems (such as Home Assistant), while Camera Event Manager provides a centralized interface for organizing, browsing, searching, and managing recordings.

The system shall be designed to support future AI capabilities without requiring significant architectural changes.

---

# Development Roadmap

## Phase 1 - Recording Timeline (MVP)

### Objective

Provide a web application for browsing and viewing recordings stored on the NAS.

This phase establishes the recording library, timeline, and playback experience.

### Camera Management

The system shall allow users to configure cameras.

Each camera shall have:

* Name
* Description (optional)
* Camera type — **Generic** (scan a folder), **Hikvision** (pull clips directly), or **Aqura** (scan an Aqura NAS upload folder)
* Recording location
* Location (e.g. Front Yard, Garage, Living Room)
* Enabled/Disabled status
* Display order
* Clip Storage Strategy — how clips are laid out/timestamped (currently *Daily folders (YYYY-MM-DD)* for Generic/Hikvision, *Aqura NAS Upload (YYYYMMDD)* for Aqura; always auto-set for Aqura)
* Scan schedule — automatic filesystem scan interval, or **Never** (manual only)

Hikvision cameras additionally have:

* Host, username, password (credentials stored server-side; never returned by the API)
* Download schedule — automatic clip-download interval, or **Never** (manual only)
* Purge retention — delete clips older than *N* days, or **Never** (keep everything); with an automatic purge interval, or **Never** (manual only)

Aqura cameras additionally have:

* 3 RTSP stream URLs — user-entered (e.g. `rtsp://192.168.1.10:554/Streaming/Channels/101`)
* RTSP username and password — used to authenticate the live-view streams
* Clip strategy is always set to *Aqura NAS Upload (YYYYMMDD)* — no user choice
* No download or purge (the camera writes to a NAS share; the app only scans)
* Live view with 3 quality options (Channel1, Channel2, Channel3)

The system shall, for Hikvision cameras:

* Download recordings directly from the camera over ISAPI into per-day folders, indexing them like scanned clips
* Purge old recordings — permanently delete clips older than the configured retention window (video file, thumbnail, and index entry), on a schedule or on demand
* Show live device details (model, firmware, RTSP and snapshot URLs) on the camera page
* Provide a real-time **live view** (WebRTC, via an embedded go2rtc bridge) at the top of the camera page, with a switch between the **main** (HD) and **sub** (SD) streams
* Report when clips were last downloaded, with per-camera download history
* Offer a manual **Download Videos** and **Purge Old Videos** action alongside **Scan**

The system shall, for Aqura cameras:

* Scan the recording folder for clips placed there by the camera's NAS upload feature
* Provide a real-time **live view** (WebRTC, via go2rtc) with 3 quality options (Channel1, Channel2, Channel3) from user-configured RTSP URLs
* Show the configured RTSP URLs and username on the camera page
* Support a clip storage strategy of *Aqura NAS Upload (YYYYMMDD)* — same scanner timestamp derivation as daily_folder (embedded metadata first, then file mtime)
* Not offer download or purge functionality (scan-only)

The system shall allow users to:

* Add cameras
* Edit camera information
* Remove cameras
* Enable or disable cameras

The system shall allow users to create and manage locations.

Each camera shall belong to a single location.

Locations shall be used throughout the application for organization and future timeline grouping.

---

### Recording Library

The system shall:

* Scan one or more configured recording locations.
* Import existing recordings already stored on the NAS.
* Detect newly added recordings.
* Avoid importing duplicate recordings.
* Maintain metadata for imported recordings.
* Generate thumbnails.
* Allow manual rescanning.

For each recording the system shall maintain:

* Camera
* Start time
* End time
* Duration
* File size
* Thumbnail
* Recording status

---

### Timeline

The timeline shall be the primary interface for reviewing recordings.

The system shall provide:

* Multi-camera timeline
* Daily timeline view
* Previous and next day navigation
* Zoomable timeline
* Visual representation of recording duration
* Click-to-play recordings

The timeline shall display cameras using the configured display order.

Future versions shall support grouping by location.

---

### Video Playback

The system shall:

* Play recordings directly in the browser.
* Display recording metadata.
* Download recordings.
* Delete recordings.

---

### Search

Users shall be able to search recordings using:

* Camera
* Location
* Date
* Time

---

### Storage

The system shall display:

* Total recordings
* Storage consumed
* Available storage
* Last successful scan

---

### Recording Health

The system shall identify:

* Missing recordings
* Duplicate recordings
* Corrupted recordings
* Missing thumbnails
* Metadata entries without corresponding recording files

---

### Dashboard

The application shall provide a dashboard displaying:

* Camera status
* Total recordings
* Recent recordings
* Storage utilization
* Recording health summary

---

### Settings

The application shall allow configuration of:

* Recording locations
* Cameras (including a per-camera scan schedule — how often that camera's folders are
  scanned for new recordings, or **Never** for manual-only; default **Never**)
* Locations
* Thumbnail generation
* Display timezone (all UI timestamps shown in a configurable IANA timezone; stored as UTC internally)

---

### Out of Scope

The following capabilities are intentionally excluded from Phase 1:

* Event management
* Camera control (snapshot, reboot)
* Home Assistant integration
* Favorites
* Notes
* Tags
* AI features
* Mobile application
* User authentication

---

# Phase 2 - Event Timeline

## Objective

Transform the recording timeline into a unified event timeline.

### Functional Requirements

The system shall:

* Support events independent of recordings.
* Associate recordings with events.
* Display events alongside recordings.
* Support multiple event categories.
* Filter by event type.
* Display event details.

Example event types include:

* Door opened
* Garage opened
* Doorbell
* Smoke alarm
* Water leak
* Manual recording
* System events

This phase also introduces external event submission.

---

# Phase 3 - Camera Management

## Objective

Provide operational management of configured cameras.

### Functional Requirements

The system shall provide:

* Live camera view ✅ (WebRTC via embedded go2rtc; main/sub stream switch)
* Manual snapshot capture
* Camera information
* Camera configuration
* Camera reboot
* Camera health monitoring

---

# Phase 4 - Recording Management

## Objective

Provide enhanced organization of recordings.

### Functional Requirements

The system shall support:

* Favorites
* Notes
* Tags
* Bulk operations
* Advanced filtering
* Metadata editing
* Duplicate management

---

# Phase 5 - Storage Management

## Objective

Automate storage maintenance.

### Functional Requirements

The system shall provide:

* Automatic retention policies — global/advanced policies extending the per-camera Hikvision purge shipped in Phase 1
* Automatic cleanup
* Storage statistics
* Recording integrity verification
* Thumbnail regeneration
* Database maintenance

---

# Phase 6 - External Integration

## Objective

Allow external systems to interact with Camera Event Manager.

### Functional Requirements

The system shall support:

* Recording submission
* Event submission
* Camera operations
* Home Assistant integration
* Webhooks for system events

---

# Phase 7 - AI Foundation

## Objective

Prepare the application for future AI capabilities.

### Functional Requirements

The system shall support:

* AI annotations
* Object metadata
* Confidence scores
* Regions of interest
* AI overlays
* Extensible metadata

No AI processing is included in this phase.

---

# Phase 8 - AI Integration

Potential future capabilities include:

* Person detection
* Vehicle detection
* Package detection
* Animal detection
* Face recognition
* License plate recognition
* Semantic search
* Cross-camera event correlation
* AI-generated event summaries

---

# Guiding Principles

* Event-driven rather than recording-driven.
* Timeline-first user experience.
* Simple and lightweight deployment.
* Modular architecture that supports future expansion.
* Designed for a small number of cameras while scaling to hundreds of thousands of recordings.
* Future AI capabilities should integrate without requiring major redesign.
