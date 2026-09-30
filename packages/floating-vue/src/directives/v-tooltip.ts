import { App, createApp, customRef, h, queuePostFlushCb, Ref, shallowRef } from 'vue'
import TooltipDirective from '../components/TooltipDirective.vue'
import { getDefaultConfig } from '../config'
import { placements } from '../util/popper'

const TARGET_CLASS = 'v-popper--has-tooltip'

/**
 * Support placement as directive modifier
 */
export function getPlacement (options, modifiers) {
  let result = options.placement
  if (!result && modifiers) {
    for (const pos of placements) {
      if (modifiers[pos]) {
        result = pos
      }
    }
  }
  if (!result) {
    result = getDefaultConfig(options.theme || 'tooltip', 'placement')
  }
  return result
}

export function getOptions (el, value, modifiers) {
  let options
  const type = typeof value
  if (type === 'string') {
    options = { content: value }
  } else if (value && type === 'object') {
    options = value
  } else {
    options = { content: false }
  }
  options.placement = getPlacement(options, modifiers)
  options.targetNodes = () => [el]
  options.referenceNode = () => el
  return options
}

interface Directive {
  id: number
  options: Ref<any>
  shown: Ref<boolean>
}

let directiveApp: App
const directives: Directive[] = []
let uid = 0

/**
 * All directive tooltips are rendered by one shared app. Its render must not track
 * each directive's state: when many directives are created, updated or destroyed in
 * the same tick (for example one per cell of a large grid, each in its own component
 * job), every change would re-queue the shared app's render job after the job that
 * caused it, and the flush would hit Vue's recursive update limit and drop the
 * remaining jobs. Changes are coalesced instead: the render tracks a single revision
 * that is bumped at most once per flush, at the end of it.
 */
const revision = shallowRef(0)
let updateQueued = false

function bumpRevision () {
  updateQueued = false
  revision.value++
}

function scheduleDirectiveAppUpdate () {
  if (updateQueued) return
  updateQueued = true
  queuePostFlushCb(bumpRevision)
}

/**
 * A ref that is not tracked by the shared app's render; setting it schedules one
 * coalesced re-render of the shared app.
 */
function directiveStateRef<T> (initial: T): Ref<T> {
  let value = initial
  return customRef(() => ({
    get: () => value,
    set: (newValue: T) => {
      value = newValue
      scheduleDirectiveAppUpdate()
    },
  }))
}

function ensureDirectiveApp () {
  if (directiveApp) return

  directiveApp = createApp({
    name: 'VTooltipDirectiveApp',
    setup () {
      return {
        revision,
      }
    },
    render () {
      // Track the revision only; directive state is read untracked.
      // eslint-disable-next-line no-unused-expressions
      this.revision
      return directives.map((directive) => {
        const options = directive.options.value
        const shown = directive.shown.value
        return h(TooltipDirective, {
          ...options,
          shown: shown || options.shown,
          key: directive.id,
        })
      })
    },
    devtools: {
      hide: true,
    },
  })

  const mountTarget = document.createElement('div')
  document.body.appendChild(mountTarget)
  directiveApp.mount(mountTarget)
}

export function createTooltip (el, value, modifiers) {
  ensureDirectiveApp()
  const options = directiveStateRef(getOptions(el, value, modifiers))
  const shown = directiveStateRef(false)

  const item = {
    id: uid++,
    options,
    shown,
  }
  directives.push(item)
  scheduleDirectiveAppUpdate()

  // Class on target
  if (el.classList) {
    el.classList.add(TARGET_CLASS)
  }

  const result = el.$_popper = {
    options,
    item,
    show () {
      shown.value = true
    },
    hide () {
      shown.value = false
    },
  }

  return result
}

export function destroyTooltip (el) {
  if (el.$_popper) {
    const index = directives.indexOf(el.$_popper.item)
    if (index !== -1) {
      directives.splice(index, 1)
      scheduleDirectiveAppUpdate()
    }

    delete el.$_popper
    delete el.$_popperOldShown
    delete el.$_popperMountTarget
  }

  if (el.classList) {
    el.classList.remove(TARGET_CLASS)
  }
}

export function bind (el, { value, modifiers }) {
  const options = getOptions(el, value, modifiers)
  if (!options.content || getDefaultConfig(options.theme || 'tooltip', 'disabled')) {
    destroyTooltip(el)
  } else {
    let directive
    if (el.$_popper) {
      directive = el.$_popper
      directive.options.value = options
    } else {
      directive = createTooltip(el, value, modifiers)
    }

    // Manual show
    if (typeof value.shown !== 'undefined' && value.shown !== el.$_popperOldShown) {
      el.$_popperOldShown = value.shown
      value.shown ? directive.show() : directive.hide()
    }
  }
}

export default {
  beforeMount: bind,
  updated: bind,
  beforeUnmount (el) {
    destroyTooltip(el)
  },
}
