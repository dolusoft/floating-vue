// Regression tests against the built bundle: unchanged hosts must not render tooltips.
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
const { default: FloatingVue } = await import('../../dist/floating-vue.mjs')
const N = 300
const flush = async () => { await nextTick(); await nextTick() }
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
async function waitFor (predicate) {
  for (let i = 0; i < 20 && !predicate(); i++) await settle()
  assert.ok(predicate(), 'tooltip reached the expected shown state')
}

async function mountCells ({ object = false, shown = false, reused = false } = {}) {
  const ticks = Array.from({ length: N }, () => ref(0))
  const contents = Array.from({ length: N }, (_, i) => ref(`content-${i}`))
  const placements = Array.from({ length: N }, () => ref('top'))
  const values = contents.map(content => ({ content: content.value, placement: 'top' }))
  const Cell = defineComponent({
    props: { i: Number },
    setup (props) {
      return () => {
        const i = props.i
        const value = reused
          ? values[i]
          : object
            ? { content: contents[i].value, placement: placements[i].value, ...(shown && i === 0 ? { shown: true, delay: 0 } : {}) }
            : contents[i].value
        return withDirectives(h('button', { 'data-tick': ticks[i].value }), [[resolveDirective('tooltip'), value]])
      }
    },
  })
  const host = document.body.appendChild(document.createElement('div'))
  const app = createApp(() => Array.from({ length: N }, (_, i) => h(Cell, { i, key: i })))
  app.use(FloatingVue)
  app.mount(host)
  await flush()
  await settle()
  const inst = [...document.body.children].map(el => el.__vue_app__?._instance).find(inst => inst?.type.name === 'VTooltipDirectiveApp')
  assert.ok(inst)
  assert.equal(inst.subTree.children.length, N)
  if (shown) await waitFor(() => inst.subTree.children[0].component.proxy.$refs.popper.isShown)
  const counts = { shared: 0, children: 0 }
  const elements = [...host.querySelectorAll('button')]
  const initialOptions = elements.map(el => el.$_popper.options.value)
  const initialNodes = initialOptions.map(options => ({ targetNodes: options.targetNodes, referenceNode: options.referenceNode }))
  const render = inst.render
  inst.render = function (...args) { counts.shared++; return render.apply(this, args) }
  for (const vnode of inst.subTree.children) {
    const child = vnode.component
    const childRender = child.render
    child.render = function (...args) { counts.children++; return childRender.apply(this, args) }
  }
  return {
    ticks,
    contents,
    placements,
    values,
    counts,
    inst,
    elements,
    initialOptions,
    initialNodes,
    async close () {
      app.unmount()
      await flush()
      await settle()
      inst.render = render
      host.remove()
    },
  }
}

async function scenario (t, options, update, expected, verify = () => {}) {
  const cells = await mountCells(options)
  try {
    await update(cells)
    await flush()
    t.diagnostic(`N=${N}: shared=${cells.counts.shared}, children=${cells.counts.children}`)
    assert.deepEqual({ ...cells.counts }, expected)
    await verify(cells)
  } finally {
    await cells.close()
  }
}

test('one unchanged host', t => scenario(t, {}, c => { c.ticks[0].value++ }, { shared: 0, children: 0 }))
test('all unchanged hosts in one tick', t => scenario(t, {}, c => { c.ticks.forEach(tick => tick.value++) }, { shared: 0, children: 0 }))
test('one changed content', t => scenario(t, {}, c => { c.contents[0].value = 'changed' }, { shared: 1, children: 1 }, c => {
  assert.equal(c.inst.subTree.children[0].component.props.content, 'changed')
}))
test('all changed contents', t => scenario(t, {}, c => { c.contents.forEach(content => { content.value += '-changed' }) }, { shared: 1, children: N }, c => {
  c.inst.subTree.children.forEach((vnode, i) => assert.equal(vnode.component.props.content, `content-${i}-changed`))
}))
test('equal recreated object bindings', t => scenario(t, { object: true }, c => { c.ticks.forEach(tick => tick.value++) }, { shared: 0, children: 0 }, c => {
  c.elements.forEach((el, i) => assert.equal(el.$_popper.options.value, c.initialOptions[i]))
}))
test('one changed placement', t => scenario(t, { object: true }, c => { c.placements[0].value = 'bottom' }, { shared: 1, children: 1 }, c => {
  assert.equal(c.inst.subTree.children[0].props.placement, 'bottom')
  assert.equal(c.elements[0].$_popper.options.value.targetNodes, c.initialNodes[0].targetNodes)
  assert.equal(c.elements[0].$_popper.options.value.referenceNode, c.initialNodes[0].referenceNode)
}))
test('an open tooltip stays open after an unchanged host update', t => scenario(t, { object: true, shown: true }, c => {
  assert.equal(c.inst.subTree.children[0].component.proxy.$refs.popper.isShown, true)
  c.ticks[0].value++
}, { shared: 0, children: 0 }, c => {
  assert.equal(c.inst.subTree.children[0].component.proxy.$refs.popper.isShown, true)
}))
test('a reused object with mutated content', t => scenario(t, { reused: true }, c => {
  c.values[0].content = 'mutated'
  c.ticks[0].value++
}, { shared: 1, children: 1 }, c => {
  assert.equal(c.inst.subTree.children[0].component.props.content, 'mutated')
}))
test('added and removed option keys on a reused object', t => scenario(t, { reused: true }, async c => {
  c.values[0].ariaId = 'custom-tooltip'
  c.ticks[0].value++
  await flush()
  assert.equal(c.inst.subTree.children[0].props.ariaId, 'custom-tooltip')
  delete c.values[0].ariaId
  c.ticks[0].value++
}, { shared: 2, children: 2 }, c => {
  assert.equal('ariaId' in c.inst.subTree.children[0].props, false)
}))

test('the writable options ref propagates changes and keeps its snapshot current', t => scenario(t, { reused: true }, async c => {
  const options = c.elements[0].$_popper.options
  c.values[0].content = 'external'
  options.value = c.values[0]
  await flush()
  assert.equal(options.value, c.values[0])
  assert.equal(c.inst.subTree.children[0].component.props.content, 'external')
  c.ticks[0].value++
}, { shared: 1, children: 1 }))

test('show/hide, manual shown, target class and destruction remain supported', async () => {
  const cells = await mountCells({ reused: true })
  try {
    const el = cells.elements[0]
    const popper = () => cells.inst.subTree.children[0].component.proxy.$refs.popper
    cells.values[0].delay = 0
    cells.ticks[0].value++
    await flush()
    assert.ok(el.classList.contains('v-popper--has-tooltip'))
    el.$_popper.show()
    await flush(); await waitFor(() => popper().isShown)
    assert.equal(popper().isShown, true)
    el.$_popper.hide()
    await flush(); await waitFor(() => !popper().isShown)
    assert.equal(popper().isShown, false)
    cells.values[0].shown = true
    cells.ticks[0].value++
    await flush(); await waitFor(() => popper().isShown)
    assert.equal(popper().isShown, true)
    cells.values[0].shown = false
    cells.ticks[0].value++
    await flush(); await waitFor(() => !popper().isShown)
    assert.equal(popper().isShown, false)
    cells.values[0].content = ''
    cells.ticks[0].value++
    await flush()
    assert.equal(el.$_popper, undefined)
    assert.equal(el.classList.contains('v-popper--has-tooltip'), false)
    assert.equal(cells.inst.subTree.children.length, N - 1)
    cells.values[0].content = 'restored'
    cells.ticks[0].value++
    await flush()
    assert.ok(el.$_popper)
    FloatingVue.options.themes.tooltip.disabled = true
    cells.ticks[0].value++
    await flush()
    assert.equal(el.$_popper, undefined)
    assert.equal(el.classList.contains('v-popper--has-tooltip'), false)
  } finally {
    FloatingVue.options.themes.tooltip.disabled = false
    await cells.close()
  }
})
