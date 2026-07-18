import '@testing-library/jest-dom/vitest'

// Hydrate the constants singleton from a committed snapshot of the LIVE Bible
// before any test module loads. Vitest runs setupFiles before the test files, so
// the many `const C = loadConstants()` calls at test-module top level resolve
// against the real (live-shaped) Bible.
//
// A test may read the Bible at build time — a test is not the app. The app itself
// must fetch the live Bible over the network (src/bible/liveBible.js); the app must
// never bundle it. The snapshot below is the live bible.json
// (https://shared-underwriting-standards.vercel.app/bible.json) captured at v11.25;
// refresh it if the Bible's shape changes.
import bibleSnapshot from './bibleSnapshot.json'
import { setBibleStandards } from '../math/constants.js'

setBibleStandards(bibleSnapshot.standards)
