/**
 * S3.2 — Navegación UI de CourseContextSwitcher (contrato real del componente).
 * No mockea store/switch. No toca EvaluatorClient.
 * Ejecutar: npx tsx app/lib/__tests__/course-context-switcher-s3-2.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "path"
import React from "react"
import {
  CourseContextSwitcher,
  type CourseContextSwitcherItem,
} from "../../components/evaluator/CourseContextSwitcher"
import { MAX_COURSE_CONTEXTS } from "../course-contexts/types"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const ID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const ID_E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

function item(
  contextId: string,
  courseValue: string,
  extra?: Partial<CourseContextSwitcherItem>,
): CourseContextSwitcherItem {
  return {
    contextId,
    courseValue,
    classSize: extra?.classSize ?? 25,
    displayStatus: extra?.displayStatus ?? "DRAFT",
    batchId: extra?.batchId ?? contextId,
  }
}

function collect(node: unknown): React.ReactElement[] {
  const out: React.ReactElement[] = []
  const walk = (n: unknown): void => {
    if (n == null || typeof n === "boolean") return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (!React.isValidElement(n)) return
    out.push(n)
    walk((n.props as { children?: unknown }).children)
  }
  walk(node)
  return out
}

function flattenText(node: unknown): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join("")
  if (React.isValidElement(node)) return flattenText((node.props as { children?: unknown }).children)
  return ""
}

type TabProps = {
  role?: string
  "aria-selected"?: boolean
  "data-context-id"?: string
  disabled?: boolean
  onClick?: () => void
  children?: unknown
}

function tabsOf(tree: unknown): Array<React.ReactElement<TabProps>> {
  return collect(tree).filter((el) => (el.props as TabProps).role === "tab") as Array<
    React.ReactElement<TabProps>
  >
}

function tabById(tree: unknown, contextId: string): React.ReactElement<TabProps> {
  const found = tabsOf(tree).find((el) => el.props["data-context-id"] === contextId)
  assert.ok(found, `falta tab ${contextId}`)
  return found
}

function buttonsWithText(tree: unknown, text: string): Array<React.ReactElement<{ onClick?: () => void; disabled?: boolean; children?: unknown }>> {
  return collect(tree).filter((el) => flattenText(el.props.children).trim() === text) as Array<
    React.ReactElement<{ onClick?: () => void; disabled?: boolean; children?: unknown }>
  >
}

function render(overrides: Partial<Parameters<typeof CourseContextSwitcher>[0]> & {
  items?: CourseContextSwitcherItem[]
  activeContextId?: string | null
} = {}) {
  const onCreate = overrides.onCreate ?? (() => {})
  const onSwitch = overrides.onSwitch ?? ((_id: string) => {})
  const onConfirm = overrides.onConfirm ?? ((_id: string) => {})
  const onUnconfirm = overrides.onUnconfirm ?? ((_id: string) => {})
  const onDelete = overrides.onDelete ?? ((_id: string) => {})
  const items =
    overrides.items ??
    [
      item(ID_A, "8°A", { displayStatus: "DRAFT" }),
      item(ID_B, "8°B", { displayStatus: "ACTIVE", classSize: 4 }),
    ]
  const tree = CourseContextSwitcher({
    items,
    activeContextId: overrides.activeContextId === undefined ? ID_B : overrides.activeContextId,
    switchBlocked: overrides.switchBlocked ?? false,
    switchBlockedReason: overrides.switchBlockedReason ?? null,
    rosterLocked: overrides.rosterLocked ?? false,
    instrumentLocked: overrides.instrumentLocked ?? false,
    canCreate: overrides.canCreate ?? items.length < MAX_COURSE_CONTEXTS,
    onCreate,
    onSwitch,
    onConfirm,
    onUnconfirm,
    onDelete,
    onCourseLabelChange: overrides.onCourseLabelChange,
    courseLabel: overrides.courseLabel,
  })
  return { tree, onCreate, onSwitch, onConfirm, onUnconfirm, onDelete, items }
}

test("T1 renderizar A y B simultáneamente", () => {
  const { tree } = render()
  const tabs = tabsOf(tree)
  assert.equal(tabs.length, 2)
  const ids = tabs.map((t) => t.props["data-context-id"]).sort()
  assert.deepEqual(ids, [ID_A, ID_B].sort())
  const allText = flattenText(tree)
  assert.match(allText, /8°A/)
  assert.match(allText, /8°B/)
})

test("T2 B activo se distingue", () => {
  const { tree } = render({ activeContextId: ID_B })
  const a = tabById(tree, ID_A)
  const b = tabById(tree, ID_B)
  assert.equal(b.props["aria-selected"], true)
  assert.equal(a.props["aria-selected"], false)
  const all = collect(tree)
  const activeLi = all.find(
    (el) =>
      el.type === "li" &&
      flattenText(el.props.children).includes("8°B") &&
      String((el.props as { className?: string }).className ?? "").includes("text-accent"),
  )
  const inactiveLi = all.find(
    (el) =>
      el.type === "li" &&
      flattenText(el.props.children).includes("8°A") &&
      !flattenText(el.props.children).includes("8°B"),
  )
  assert.ok(activeLi, "li de B debe usar borde/fondo de activo")
  assert.ok(inactiveLi, "li de A presente")
  const inactiveClass = String((inactiveLi.props as { className?: string }).className ?? "")
  assert.equal(inactiveClass.includes("text-accent"), false)
})

test("T3 A aparece seleccionable", () => {
  const { tree } = render({ activeContextId: ID_B })
  const a = tabById(tree, ID_A)
  assert.equal(a.props["aria-selected"], false)
  assert.equal(typeof a.props.onClick, "function")
  assert.equal(a.props.disabled, false)
})

test("T4 click A llama exactamente una vez onSwitch(A)", () => {
  const calls: string[] = []
  const { tree } = render({
    activeContextId: ID_B,
    onSwitch: (id) => calls.push(id),
  })
  const a = tabById(tree, ID_A)
  assert.equal(typeof a.props.onClick, "function")
  a.props.onClick!()
  assert.deepEqual(calls, [ID_A])
})

test("T5 click B existente no crea nuevo contexto", () => {
  let createCount = 0
  const switchCalls: string[] = []
  const { tree } = render({
    activeContextId: ID_A,
    onCreate: () => {
      createCount += 1
    },
    onSwitch: (id) => switchCalls.push(id),
  })
  const b = tabById(tree, ID_B)
  b.props.onClick!()
  assert.equal(createCount, 0)
  assert.deepEqual(switchCalls, [ID_B])
  assert.equal(tabsOf(tree).length, 2)
})

test("T6 + Curso usa callback de creación existente", () => {
  let createCount = 0
  const { tree } = render({
    onCreate: () => {
      createCount += 1
    },
  })
  const createBtns = buttonsWithText(tree, "+ Curso")
  assert.equal(createBtns.length, 1)
  assert.equal(typeof createBtns[0]!.props.onClick, "function")
  createBtns[0]!.props.onClick!()
  assert.equal(createCount, 1)
})

test("T7 máximo 4 conserva comportamiento actual", () => {
  const four = [
    item(ID_A, "8°A", { displayStatus: "DRAFT" }),
    item(ID_B, "8°B", { displayStatus: "ACTIVE" }),
    item(ID_C, "8°C", { displayStatus: "DRAFT" }),
    item(ID_D, "8°D", { displayStatus: "DRAFT" }),
  ]
  let createCount = 0
  const { tree } = render({
    items: four,
    activeContextId: ID_B,
    canCreate: four.length < MAX_COURSE_CONTEXTS,
    onCreate: () => {
      createCount += 1
    },
  })
  assert.equal(MAX_COURSE_CONTEXTS, 4)
  assert.equal(tabsOf(tree).length, 4)
  assert.match(flattenText(tree), /Máximo 4 contextos/)
  const createBtns = buttonsWithText(tree, "+ Curso")
  assert.equal(createBtns.length, 1)
  assert.equal(createBtns[0]!.props.disabled, true)
  if (createBtns[0]!.props.onClick) createBtns[0]!.props.onClick()
  assert.equal(createCount, 1, "onClick sigue cableado; el padre deshabilita el control (disabled=true)")
  const fiveIds = [ID_A, ID_B, ID_C, ID_D, ID_E]
  assert.equal(fiveIds.length, 5)
  assert.equal(four.length, MAX_COURSE_CONTEXTS)
})

test("T8 contexto activo NO dispara onSwitch innecesariamente", () => {
  const calls: string[] = []
  const { tree } = render({
    activeContextId: ID_B,
    onSwitch: (id) => calls.push(id),
  })
  const b = tabById(tree, ID_B)
  assert.equal(b.props["aria-selected"], true)
  assert.equal(b.props.onClick, undefined)
  assert.deepEqual(calls, [])
})

test("T9 no se dispara delete al hacer switch", () => {
  const deleted: string[] = []
  const switched: string[] = []
  const { tree } = render({
    activeContextId: ID_B,
    onDelete: (id) => deleted.push(id),
    onSwitch: (id) => switched.push(id),
  })
  const a = tabById(tree, ID_A)
  a.props.onClick!()
  assert.deepEqual(switched, [ID_A])
  assert.deepEqual(deleted, [])
  const del = buttonsWithText(tree, "Eliminar")
  assert.ok(del.length >= 1)
  del[0]!.props.onClick!()
  assert.equal(deleted.length, 1)
  assert.deepEqual(switched, [ID_A])
})

test("T10 label visible utiliza fuente existente y no crea estado duplicado", () => {
  const { tree } = render({
    items: [
      item(ID_A, "8°A", { displayStatus: "DRAFT" }),
      item(ID_B, "8°B", { displayStatus: "ACTIVE" }),
    ],
    activeContextId: ID_B,
  })
  assert.equal(flattenText(tabById(tree, ID_A).props.children).trim(), "8°A")
  assert.equal(flattenText(tabById(tree, ID_B).props.children).trim(), "8°B")
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../components/evaluator/CourseContextSwitcher.tsx"),
    "utf8",
  )
  assert.doesNotMatch(src, /\buseState\b/)
  assert.doesNotMatch(src, /\buseReducer\b/)
  assert.match(src, /item\.courseValue/)
  assert.doesNotMatch(src, /context\.label/)
  assert.equal("label" in item(ID_A, "8°A"), false)
  const inputs = collect(tree).filter(
    (el) => (el.props as { id?: string }).id === "course-context-label",
  )
  assert.equal(inputs.length, 0, "sin onCourseLabelChange no hay segunda fuente de etiqueta")
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
