/**
 * S3 FLAG-FIX — lectura NEXT_PUBLIC literal (camino real, sin mock de objeto env).
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-flag-next-public.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "path"
import {
  COURSE_CONTEXTS_ENABLED_DEFAULT,
  COURSE_CONTEXTS_FLAG_ENV,
  isCourseContextsEnabled,
  shouldMountCourseContextSwitcher,
} from "../course-contexts/flag"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ENV_KEY = "NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED"
const FLAG_SRC = fs.readFileSync(path.resolve(__dirname, "../course-contexts/flag.ts"), "utf8")

function withProcessEnv(value: string | undefined, fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY)
  const prev = process.env[ENV_KEY]
  try {
    if (value === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = value
    fn()
  } finally {
    if (had) {
      if (prev === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = prev
    } else {
      delete process.env[ENV_KEY]
    }
  }
}

test("T1 env ausente → false (camino real, sin objeto env)", () => {
  withProcessEnv(undefined, () => {
    assert.equal(isCourseContextsEnabled(), false)
  })
})

test("T2 env false → false (camino real)", () => {
  withProcessEnv("false", () => {
    assert.equal(isCourseContextsEnabled(), false)
  })
})

test("T3 env true → true (camino real)", () => {
  withProcessEnv("true", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
})

test("T4 default sigue false", () => {
  assert.equal(COURSE_CONTEXTS_ENABLED_DEFAULT, false)
  withProcessEnv(undefined, () => {
    assert.equal(isCourseContextsEnabled(), false)
  })
})

test("T5 API pública del flag preservada + inyección de tests intacta", () => {
  assert.equal(typeof isCourseContextsEnabled, "function")
  assert.equal(typeof shouldMountCourseContextSwitcher, "function")
  assert.equal(COURSE_CONTEXTS_FLAG_ENV, ENV_KEY)
  assert.equal(isCourseContextsEnabled({}), false)
  assert.equal(isCourseContextsEnabled({ [ENV_KEY]: undefined }), false)
  assert.equal(isCourseContextsEnabled({ [ENV_KEY]: "false" }), false)
  assert.equal(isCourseContextsEnabled({ [ENV_KEY]: "true" }), true)
  assert.equal(shouldMountCourseContextSwitcher(false), false)
  assert.equal(shouldMountCourseContextSwitcher(true), true)
})

test("T9 feature ON resoluble localmente por process.env literal", () => {
  withProcessEnv("true", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
  withProcessEnv("1", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
  withProcessEnv("yes", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
  withProcessEnv("on", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
})

test("T10 acceso dinámico ya no es el camino sin override; literal NEXT_PUBLIC presente", () => {
  assert.match(FLAG_SRC, /process\.env\.NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED/)
  assert.doesNotMatch(FLAG_SRC, /env\?\.\[COURSE_CONTEXTS_FLAG_ENV\]/)
  assert.match(FLAG_SRC, /env !== undefined \? env\[COURSE_CONTEXTS_FLAG_ENV\] : fromProcess/)
})

test("semántica actual: 0/espacios/mayúsculas sin ampliar parser", () => {
  withProcessEnv("0", () => {
    assert.equal(isCourseContextsEnabled(), false)
  })
  withProcessEnv(" TRUE ", () => {
    assert.equal(isCourseContextsEnabled(), true)
  })
  withProcessEnv("False", () => {
    assert.equal(isCourseContextsEnabled(), false)
  })
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (e) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
