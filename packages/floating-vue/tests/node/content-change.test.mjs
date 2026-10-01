// Regression test: changing a v-tooltip's content must not throw when the tooltip is closed or
// is removed right after the change, and must still reposition an open tooltip.
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

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

function findDirectiveAppInstance () {
  for (const el of document.body.children) {
    const app = el.__vue_app__
    if (app && app._component.name === 'VTooltipDirectiveApp') return app._instance
  }
  return null
}

// Collects Vue warnings and the errors Vue rethrows from async watcher callbacks
// (in development they surface as unhandled promise rejections).
async function collectProblems (scenario) {
  const warnings = []
  const rejections = []
  const origWarn = console.warn
  const onRejection = reason => { rejections.push(reason) }
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  process.on('unhandledRejection', onRejection)
  try {
    await scenario()
    await settle()
  } finally {
    console.warn = origWarn
    process.off('unhandledRejection', onRejection)
  }
  return { warnings, rejections }
}

function mountToolbar ({ shown = false } = {}) {
  const label = ref('Open settings')
  const menuOpen = ref(true)
  const Toolbar = defineComponent({
    setup () {
      // Like frontendx's LanguageToolbar: the tooltip target lives inside a dropdown menu
      // that is closed right after the UI language (and so the tooltip content) changes.
      return () => h('div', menuOpen.value
        ? [withDirectives(h('button', { class: 'settings' }), [[resolveDirective('tooltip'), { content: label.value, ...(shown ? { shown, delay: 0 } : {}) }]])]
        : [])
    },
  })
  const app = createApp(Toolbar)
  app.use(FloatingVue)
  const host = document.body.appendChild(document.createElement('div'))
  app.mount(host)
  return {
    label,
    menuOpen,
    unmount () {
      app.unmount()
      host.remove()
    },
  }
}

function findTooltip (content) {
  const inst = findDirectiveAppInstance()
  assert.ok(inst, 'directive app mounted')
  const vnode = inst.subTree.children.find(child => child.props.content === content)
  assert.ok(vnode, `tooltip with content "${content}" rendered`)
  return vnode.component.proxy
}

test('changing the content of a closed tooltip does not throw or warn', async () => {
  const toolbar = mountToolbar()
  await settle()
  try {
    const { warnings, rejections } = await collectProblems(async () => {
      toolbar.label.value = 'Saat dilimi ayarlarını aç'
      await nextTick()
    })
    assert.deepEqual(rejections, [])
    assert.deepEqual(warnings, [])
    assert.equal(findTooltip('Saat dilimi ayarlarını aç').$refs.popper.isShown, false)
  } finally {
    toolbar.unmount()
    await settle()
  }
})

test('a tooltip removed right after its content changed does not throw or warn', async () => {
  const toolbar = mountToolbar()
  await settle()
  try {
    const { warnings, rejections } = await collectProblems(async () => {
      // frontendx selectLanguage(): await the locale switch, then close the dropdown.
      const switchLanguage = async () => {
        toolbar.label.value = 'Saat dilimi ayarlarını aç'
        return true
      }
      await switchLanguage()
      toolbar.menuOpen.value = false
      await nextTick()
    })
    assert.deepEqual(rejections, [])
    assert.deepEqual(warnings, [])
    assert.equal(findDirectiveAppInstance().subTree.children.length, 0, 'tooltip removed')
  } finally {
    toolbar.unmount()
    await settle()
  }
})

test('an open tooltip is repositioned when its content changes', async () => {
  const toolbar = mountToolbar({ shown: true })
  await settle()
  try {
    const popper = findTooltip('Open settings').$refs.popper
    assert.equal(popper.isShown, true, 'tooltip is open')

    let computeCalls = 0
    const computePosition = popper.$_computePosition
    popper.$_computePosition = function (...args) {
      computeCalls++
      return computePosition.apply(this, args)
    }

    const { warnings, rejections } = await collectProblems(async () => {
      toolbar.label.value = 'Saat dilimi ayarlarını aç'
      await nextTick()
    })
    assert.deepEqual(rejections, [])
    assert.deepEqual(warnings, [])
    assert.ok(computeCalls >= 1, `position recomputed after the content change (calls: ${computeCalls})`)
  } finally {
    toolbar.unmount()
    await settle()
  }
})
