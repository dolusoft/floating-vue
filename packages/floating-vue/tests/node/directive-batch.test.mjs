// Regression test: many v-tooltip directives created/updated in one tick must not
// re-render the shared VTooltipDirectiveApp once per directive (Vue recursive update limit).
// Runs against the built bundle: `pnpm run build && pnpm run test:node`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const window = new Window()
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Text', 'Comment', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (!(key in globalThis) || key === 'navigator') {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
  }
}
if (typeof globalThis.requestAnimationFrame !== 'function') globalThis.requestAnimationFrame = cb => setTimeout(cb, 0)

const { createApp, defineComponent, h, nextTick, ref, withDirectives, resolveDirective } = await import('vue')
const FloatingVue = (await import('../../dist/floating-vue.mjs')).default

const N = 300

function findDirectiveAppInstance () {
  for (const el of document.body.children) {
    const app = el.__vue_app__
    if (app && app._component.name === 'VTooltipDirectiveApp') return app._instance
  }
  return null
}

test(`${N} directives created and updated in one tick render the shared app a bounded number of times`, async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    const on = ref(false)
    const label = ref('a')

    // Each cell is its own component (own scheduler job), as in frontendx grid cells.
    const Cell = defineComponent({
      props: { i: Number },
      setup (props) {
        // Edit-mode controls appear with their tooltips: the directive is mounted
        // (beforeMount) inside each cell's own render job.
        return () => h('div', { class: 'cell' }, on.value
          ? [withDirectives(h('button'), [[resolveDirective('tooltip'), `${label.value}-${props.i}`]])]
          : [])
      },
    })

    // Create the shared directive app first, so it has a lower uid than every cell.
    const first = createApp({ render: () => withDirectives(h('span'), [[resolveDirective('tooltip'), 'first']]) })
    first.use(FloatingVue)
    first.mount(document.body.appendChild(document.createElement('div')))
    await nextTick()

    const inst = findDirectiveAppInstance()
    assert.ok(inst, 'directive app mounted')
    let renders = 0
    const origRender = inst.render
    inst.render = function (...args) { renders++; return origRender.apply(this, args) }

    const cells = createApp({ render: () => Array.from({ length: N }, (_, i) => h(Cell, { i, key: i })) })
    cells.use(FloatingVue)
    cells.mount(document.body.appendChild(document.createElement('div')))
    await nextTick()

    renders = 0
    on.value = true // N directives created in one tick
    await nextTick(); await nextTick()
    const createRenders = renders
    assert.equal(document.querySelectorAll('.v-popper--has-tooltip').length, N + 1)
    assert.equal(inst.subTree.children.length, N + 1, 'shared app renders every tooltip')
    assert.equal(inst.subTree.children[N].props.content, `a-${N - 1}`)

    renders = 0
    label.value = 'b' // N directives updated in one tick
    await nextTick(); await nextTick()
    const updateRenders = renders
    assert.equal(inst.subTree.children[N].props.content, `b-${N - 1}`, 'updated content reaches the shared app')

    renders = 0
    on.value = false // N directives destroyed in one tick
    await nextTick(); await nextTick()
    const destroyRenders = renders
    assert.equal(document.querySelectorAll('.v-popper--has-tooltip').length, 1)
    assert.equal(inst.subTree.children.length, 1)

    const recursion = warnings.filter(w => w.includes('Maximum recursive updates'))
    assert.deepEqual(recursion, [], 'no recursive update warning')
    assert.ok(createRenders <= 2, `create renders: ${createRenders}`)
    assert.ok(updateRenders <= 2, `update renders: ${updateRenders}`)
    assert.ok(destroyRenders <= 2, `destroy renders: ${destroyRenders}`)
  } finally {
    console.warn = origWarn
  }
})
