import { translateLegacy } from './core/translate.js'
import { Supervisor } from './core/supervisor.js'
import { DomAdapter } from './core/adapters.js'
import { emitElements, applyOps } from './core/render-helpers.js'
import { diffMinimal } from './core/render.js'
import { createClient } from './core/client.js'
import { makeHandlerContext, dispatchEvent } from './core/handlers.js'

/**
 * Initializes the client-side Preempt application using the Providence engine.
 *
 * @useCase Main browser entry point bootstrapped by Vite.
 * @processFlow Reads #preempt-initial-data, runs translateLegacy, boots
 *   Supervisor, performs first diff/paint via DomAdapter. After first paint,
 *   mutations flow through clientAPI ops (never a full recompile).
 */
async function init() {
  try {
    const scriptEl = document.getElementById('preempt-initial-data')
    let data: any = null

    if (scriptEl?.textContent) {
      data = JSON.parse(scriptEl.textContent.trim())
    } else {
      document.querySelector<HTMLDivElement>('#app')!.innerHTML =
        '<div>Loading from backend...</div>'
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      const tagsQuery = prefersDark ? '?tags=dark-mode' : ''
      const res = await fetch(`/api/content/1${tagsQuery}`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const raw = await res.json()
      // Normalise to the Providence envelope shape
      data = {
        template: raw.template ?? raw,
        content: Array.isArray(raw.content)
          ? raw.content
          : raw.content
          ? [raw.content]
          : [],
        userData: raw.userData ?? null,
      }
    }

    // Normalise doc.content to ContentPayload[] (D2/F5 migration trap)
    if (data.content && !Array.isArray(data.content)) {
      data.content = [data.content]
    }

    // Attach userData to every payload entry so handlers can read it
    const userData: any = data.userData ?? null
    if (Array.isArray(data.content)) {
      data.content = data.content.map((p: any) => ({
        ...p,
        userData: p.userData ?? userData,
      }))
    }

    const translated = translateLegacy(data)
    const hub = (translated.root as any).hubFor

    const supervisor = new Supervisor(hub ? { hub } : {})
    ;(supervisor as any).userData = userData

    for (const n of translated.nodes) supervisor.registerNode(n)

    // Full compile at bootstrap (§4.1 — one full compile only)
    for (const n of supervisor.allNodes()) {
      if (!n.destroyed) n.compilePath()
    }

    supervisor.runPhase('after-compile')

    const clientAPI = createClient(supervisor)
    const handlerCtx = makeHandlerContext(supervisor, clientAPI)

    const mount = document.getElementById('app')!
    const prevMap: Map<string, any> = new Map()

    const render = () => {
      const actionable: any[] = []
      for (const n of supervisor.allNodes()) {
        if (!n.destroyed && n.state === 'in-tree') {
          actionable.push(...n.compilePath().actionable)
        }
      }
      const nodeMap = new Map(supervisor.allNodes().map((n) => [n.id, n]))
      const nextEls = emitElements(actionable, nodeMap as any)
      const ops = diffMinimal(prevMap, nextEls)
      applyOps(adapter, ops)
      prevMap.clear()
      for (const el of nextEls) prevMap.set(el.wire, el)
    }

    const adapter = new DomAdapter(mount, {
      onEvent: (wire: string, domEvent: Event) => {
        let node = supervisor.getNode(wire)
        if (!node) {
          const el = prevMap.get(wire)
          const propId = el?.props?.['prop:id'] as string
          if (propId && typeof propId === 'string' && propId.startsWith('preempt-node-')) {
            node = supervisor.getNode(propId.slice('preempt-node-'.length))
          }
        }
        if (node) {
          dispatchEvent(node, handlerCtx, domEvent.type, domEvent)
          render()
        }
      },
    })

    // Initial render / first paint
    render()

    // Expose clientAPI for handlers and external mutations
    ;(window as any).Preempt = { supervisor, clientAPI, translateLegacy, render }
  } catch (err) {
    console.error('Error initializing Preempt:', err)
    document.querySelector<HTMLDivElement>('#app')!.innerHTML =
      `<div>Error loading: ${err}</div>`
  }
}

init()
