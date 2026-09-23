/**
 * Element picker injected into every page via Playwright's addInitScript().
 *
 * Runs in the page's own origin before any page script. Renders a small
 * draggable floating toolbar (shadow DOM) and, while picking, highlights the
 * element under the cursor. A picked element is handed to the extension host
 * through the page bridge exposed by PlaywrightBrowserService:
 *
 *   window.__kiloPickElement(payload)  - the picked element and optional change request
 *   window.__kiloPickerState(active)   - pick-mode toggles (best effort)
 *   window.__kiloScreenshotArea(rect)  - drag-selected page area, document coords
 *
 * window.__kiloSetPickerChrome(visible) lets the extension host hide the
 * toolbar around the screenshot capture so it never lands in the image.
 *
 * The toolbar and listeners are installed in the top frame only; nested
 * iframes are not pickable.
 *
 * Keep this file dependency-free ES that runs in any modern page. Avoid
 * template literals and ${} so it can be embedded in a TS template string.
 */
export const PICKER_INIT_SCRIPT = `(() => {
  if (window.__kiloPickerLoaded) return
  window.__kiloPickerLoaded = true

  var PICK = "__kiloPickElement"
  var STATE = "__kiloPickerState"
  var SCREEN = "__kiloScreenshotArea"
  var MOBILE = "__kiloMobileMode"

  var active = false
  var mobile = false
  var overlay = null
  var host = null
  var picked = null
  var selected = null

  // Curated computed-style properties useful for UI work. Keeps the attached
  // context compact instead of dumping all ~300 computed properties.
  var STYLE_PROPS = [
    "display", "position", "top", "right", "bottom", "left", "width", "height",
    "margin", "padding", "box-sizing", "overflow", "z-index",
    "color", "background-color", "background-image",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "border", "border-radius", "box-shadow", "opacity",
    "flex-direction", "justify-content", "align-items", "gap",
    "grid-template-columns", "cursor", "visibility"
  ]

  function describe(el) {
    var rect = el.getBoundingClientRect()
    var styles = window.getComputedStyle(el)
    var computed = {}
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var prop = STYLE_PROPS[i]
      var val = styles.getPropertyValue(prop)
      if (val) computed[prop] = val
    }
    return {
      url: location.href,
      tagName: el.tagName.toLowerCase(),
      id: el.id || "",
      className: typeof el.className === "string" ? el.className : "",
      selector: selectorPath(el),
      outerHTML: el.outerHTML,
      innerText: (el.innerText || "").slice(0, 2000),
      computedStyle: computed,
      dimensions: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }
  }

  function selectorPath(el) {
    var parts = []
    var node = el
    while (node && node.nodeType === 1 && parts.length < 8) {
      var part = node.tagName.toLowerCase()
      if (node.id) {
        part += "#" + node.id
        parts.unshift(part)
        break
      }
      if (node.classList && node.classList.length) {
        part += "." + Array.prototype.slice.call(node.classList, 0, 3).join(".")
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(" > ")
  }

  function bridge(name, arg) {
    try {
      var fn = window[name]
      // CDP Runtime.addBinding functions accept a single string argument.
      if (typeof fn === "function") fn(typeof arg === "string" ? arg : JSON.stringify(arg))
    } catch (e) {}
  }

  function ensureOverlay() {
    if (overlay) return overlay
    overlay = document.createElement("div")
    overlay.style.position = "fixed"
    overlay.style.pointerEvents = "none"
    overlay.style.zIndex = "2147483647"
    overlay.style.border = "2px solid #007acc"
    overlay.style.background = "rgba(0, 122, 204, 0.15)"
    overlay.style.boxSizing = "border-box"
    overlay.style.display = "none"
    overlay.style.margin = "0"
    ;(document.documentElement || document.body).appendChild(overlay)
    return overlay
  }

  function highlight(el) {
    if (!el) {
      if (overlay) overlay.style.display = "none"
      return
    }
    var rect = el.getBoundingClientRect()
    var o = ensureOverlay()
    o.style.display = "block"
    o.style.top = rect.top + "px"
    o.style.left = rect.left + "px"
    o.style.width = rect.width + "px"
    o.style.height = rect.height + "px"
  }

  function positionCompose() {
    if (!selected || !host) return
    var rect = selected.getBoundingClientRect()
    var form = host.shadowRoot.getElementById("compose")
    highlight(selected)
    var top = rect.bottom + 8
    if (top + form.offsetHeight > window.innerHeight - 8) top = rect.top - form.offsetHeight - 8
    form.style.top = Math.max(8, Math.min(top, window.innerHeight - form.offsetHeight - 8)) + "px"
    form.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - form.offsetWidth - 8)) + "px"
  }

  function fromToolbar(e) {
    return e.target === host || (e.composedPath && e.composedPath().indexOf(host) !== -1)
  }

  function onMove(e) {
    if (!active) return
    if (fromToolbar(e)) return
    var el = e.target
    if (el && el.nodeType === 1) highlight(el)
  }

  function onClick(e) {
    if (!active) return
    if (fromToolbar(e)) return
    e.preventDefault()
    e.stopPropagation()
    var el = e.target
    if (el && el.nodeType === 1) {
      picked = describe(el)
      selected = el
      setMode(false)
      var form = host.shadowRoot.getElementById("compose")
      form.classList.remove("hidden")
      positionCompose()
      var input = host.shadowRoot.getElementById("change")
      input.value = ""
      input.focus()
    }
  }

  function onKey(e) {
    if (!active) return
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      setMode(false)
    }
  }

  function setMode(next) {
    active = !!next
    if (active) {
      document.addEventListener("mousemove", onMove, true)
      document.addEventListener("click", onClick, true)
      document.addEventListener("keydown", onKey, true)
      document.documentElement.style.cursor = "crosshair"
    } else {
      document.removeEventListener("mousemove", onMove, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("keydown", onKey, true)
      document.documentElement.style.cursor = ""
      highlight(null)
    }
    bridge(STATE, active)
    syncBar()
  }

  function syncBar() {
    if (!host) return
    var pick = host.shadowRoot.getElementById("pick")
    if (pick) {
      pick.textContent = active ? "Cancel (Esc)" : "Pick element"
      pick.classList.toggle("active", active)
    }
    var shot = host.shadowRoot.getElementById("shot")
    if (shot) shot.classList.toggle("active", selecting)
    var view = host.shadowRoot.getElementById("view")
    if (view) {
      view.classList.toggle("active", mobile)
      view.setAttribute("aria-pressed", String(mobile))
      view.title = mobile ? "Switch to desktop" : "Emulate iPhone 13"
    }
  }

  // --- area selection (drag a rectangle; the host captures the screenshot) ---

  var selecting = false
  var shroud = null
  var selBox = null
  var selTag = null
  var anchorX = 0
  var anchorY = 0

  function styleOf(el, css) {
    el.style.cssText = css
    return el
  }

  function drawSel(curX, curY) {
    var x = Math.min(anchorX, curX)
    var y = Math.min(anchorY, curY)
    var w = Math.abs(curX - anchorX)
    var h = Math.abs(curY - anchorY)
    selBox.style.left = x - window.scrollX + "px"
    selBox.style.top = y - window.scrollY + "px"
    selBox.style.width = w + "px"
    selBox.style.height = h + "px"
    selTag.style.left = x - window.scrollX + "px"
    selTag.style.top = y - window.scrollY - 22 + "px"
    selTag.textContent = Math.round(w) + " \\u00D7 " + Math.round(h)
  }

  function onSelDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    anchorX = e.clientX + window.scrollX
    anchorY = e.clientY + window.scrollY
    selBox.style.display = "block"
    selTag.style.display = "block"
    drawSel(anchorX, anchorY)
    shroud.setPointerCapture(e.pointerId)
  }

  function onSelMove(e) {
    if (selBox.style.display !== "block") return
    drawSel(e.clientX + window.scrollX, e.clientY + window.scrollY)
  }

  function onSelUp(e) {
    if (selBox.style.display !== "block") return
    var x = Math.min(anchorX, e.clientX + window.scrollX)
    var y = Math.min(anchorY, e.clientY + window.scrollY)
    var w = Math.abs(e.clientX + window.scrollX - anchorX)
    var h = Math.abs(e.clientY + window.scrollY - anchorY)
    stopSelect()
    // Too small to be a deliberate drag: treat as a cancel, not a capture.
    if (w < 8 || h < 8) return
    bridge(SCREEN, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) })
  }

  function onSelKey(e) {
    if (!selecting) return
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      stopSelect()
    }
  }

  function stopSelect() {
    selecting = false
    document.removeEventListener("keydown", onSelKey, true)
    if (shroud) {
      shroud.remove()
      shroud = null
      selBox = null
      selTag = null
    }
    syncBar()
  }

  function startSelect() {
    if (selecting) return
    setMode(false)
    selecting = true
    shroud = styleOf(document.createElement("div"),
      "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;background:rgba(0,0,0,0.12)")
    selBox = styleOf(document.createElement("div"),
      "position:fixed;display:none;border:2px solid #007acc;background:rgba(0,122,204,0.10);box-shadow:0 0 0 100000px rgba(0,0,0,0.35);box-sizing:border-box;pointer-events:none")
    selTag = styleOf(document.createElement("div"),
      "position:fixed;display:none;background:#1f1f1f;color:#ffffff;font:11px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;padding:2px 6px;border-radius:4px;pointer-events:none;white-space:nowrap")
    shroud.appendChild(selBox)
    shroud.appendChild(selTag)
    ;(document.documentElement || document.body).appendChild(shroud)
    shroud.addEventListener("pointerdown", onSelDown)
    shroud.addEventListener("pointermove", onSelMove)
    shroud.addEventListener("pointerup", onSelUp)
    document.addEventListener("keydown", onSelKey, true)
    syncBar()
  }

  // The extension host hides the toolbar before capturing the screenshot and
  // restores it afterwards, so the picker UI never lands in the image.
  window.__kiloSetPickerChrome = function (visible) {
    if (host) host.style.display = visible ? "" : "none"
  }
  window.__kiloSetMobileMode = function (enabled) {
    mobile = !!enabled
    syncBar()
  }
  var CSS = [
    ":host { all: initial; position: fixed; z-index: 2147483647; bottom: 18px; right: 18px;",
    "  font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }",
    ".bar { display: flex; align-items: center; gap: 6px; padding: 5px 7px;",
    "  background: #1f1f1f; color: #cccccc; border: 1px solid #3c3c3c; border-radius: 8px;",
    "  box-shadow: 0 4px 14px rgba(0,0,0,0.35); cursor: grab; user-select: none;",
    "  pointer-events: auto; font-size: 12px; line-height: 1; }",
    ".bar.dragging { cursor: grabbing; }",
    ".logo { color: #4fc3f7; font-size: 13px; padding: 0 2px; }",
    "button { font: inherit; border: none; border-radius: 5px; cursor: pointer;",
    "  padding: 4px 9px; line-height: 1.2; }",
    ".pick { background: #0e639c; color: #ffffff; }",
    ".pick:hover { background: #1177bb; }",
    ".pick.active { background: #c43838; }",
    ".shot { background: transparent; color: #cccccc; padding: 4px 9px; }",
    ".shot:hover, .shot.active, .view:hover, .view.active { background: #333333; color: #4fc3f7; }",
    ".view { background: transparent; color: #cccccc; padding: 3px 7px; display: inline-flex; align-items: center; }",
    ".min { background: transparent; color: #9d9d9d; padding: 4px 7px; }",
    ".min:hover { background: #333333; color: #ffffff; }",
    ".compose { position: fixed; width: 260px; padding: 10px; background: #1f1f1f; color: #cccccc;",
    "  border: 1px solid #3c3c3c; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);",
    "  font: 12px/1.4 -apple-system, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; }",
    ".compose label { display: block; margin-bottom: 6px; }",
    ".compose textarea { display: block; width: 100%; min-height: 70px; resize: vertical; box-sizing: border-box;",
    "  padding: 6px; background: #2b2b2b; color: #ffffff; border: 1px solid #555; border-radius: 4px; font: inherit; }",
    ".compose textarea:focus { outline: 1px solid #4fc3f7; }",
    ".compose .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }",
    ".compose .attach { background: #0e639c; color: #ffffff; }",
    ".compose .cancel { background: transparent; color: #cccccc; }",
    ".chip { background: #1f1f1f; color: #4fc3f7; border: 1px solid #3c3c3c; border-radius: 50%;",
    "  width: 26px; height: 26px; padding: 0; box-shadow: 0 4px 14px rgba(0,0,0,0.35);",
    "  pointer-events: auto; font-size: 13px; }",
    ".chip:hover { background: #2a2a2a; }",
    ".hidden { display: none; }"
  ].join("\\n")

  function buildToolbar() {
    host = document.createElement("div")
    host.id = "__kilo_picker_host"
    var root = host.attachShadow({ mode: "open" })

    var style = document.createElement("style")
    style.textContent = CSS
    root.appendChild(style)

    var bar = document.createElement("div")
    bar.className = "bar"
    bar.innerHTML =
      '<span class="logo">\\u25C6</span>' +
      '<button class="pick" id="pick">Pick element</button>' +
      '<button class="shot" id="shot" title="Drag an area to attach it to chat">Screenshot</button>' +
      '<button class="view" id="view" title="Emulate iPhone 13" aria-label="Toggle mobile emulation" aria-pressed="false">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<rect x="4" y="1.5" width="8" height="13" rx="1.5"/><path d="M7 12.5h2"/></svg></button>' +
      '<button class="min" id="min" title="Minimize">\\u2013</button>'
    root.appendChild(bar)

    var form = document.createElement("div")
    form.id = "compose"
    form.className = "compose hidden"
    form.innerHTML = '<label for="change">What should change in this element?</label>' +
      '<textarea id="change" placeholder="Describe the change for chat"></textarea>' +
      '<div class="actions"><button class="cancel" id="cancel">Cancel</button>' +
      '<button class="attach" id="attach">Add to chat</button></div>'
    root.appendChild(form)

    var chip = document.createElement("button")
    chip.className = "chip hidden"
    chip.id = "chip"
    chip.title = "Kilo element picker"
    chip.textContent = "\\u25C6"
    root.appendChild(chip)

    ;(document.body || document.documentElement).appendChild(host)

    var dragging = false
    var dx = 0
    var dy = 0

    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest("button")) return
      dragging = true
      bar.classList.add("dragging")
      var rect = host.getBoundingClientRect()
      dx = e.clientX - rect.left
      dy = e.clientY - rect.top
      host.style.left = rect.left + "px"
      host.style.top = rect.top + "px"
      host.style.right = "auto"
      host.style.bottom = "auto"
      bar.setPointerCapture(e.pointerId)
    })
    bar.addEventListener("pointermove", function (e) {
      if (!dragging) return
      var x = Math.min(Math.max(4, e.clientX - dx), window.innerWidth - 60)
      var y = Math.min(Math.max(4, e.clientY - dy), window.innerHeight - 40)
      host.style.left = x + "px"
      host.style.top = y + "px"
    })
    var stopDrag = function () {
      dragging = false
      bar.classList.remove("dragging")
    }
    bar.addEventListener("pointerup", stopDrag)
    bar.addEventListener("pointercancel", stopDrag)

    root.getElementById("pick").addEventListener("click", function () {
      closeCompose()
      setMode(!active)
    })
    root.getElementById("shot").addEventListener("click", function () {
      if (selecting) stopSelect()
      else startSelect()
    })
    root.getElementById("view").addEventListener("click", function () {
      bridge(MOBILE, !mobile)
    })
    function closeCompose() {
      picked = null
      selected = null
      form.classList.add("hidden")
      highlight(null)
    }
    window.addEventListener("scroll", positionCompose, true)
    window.addEventListener("resize", positionCompose)
    root.getElementById("cancel").addEventListener("click", closeCompose)
    root.getElementById("attach").addEventListener("click", function () {
      if (!picked) return
      picked.request = root.getElementById("change").value.trim()
      bridge(PICK, picked)
      closeCompose()
    })
    root.getElementById("change").addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeCompose()
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        root.getElementById("attach").click()
      }
    })
    root.getElementById("min").addEventListener("click", function () {
      bar.classList.add("hidden")
      chip.classList.remove("hidden")
    })
    chip.addEventListener("click", function () {
      chip.classList.add("hidden")
      bar.classList.remove("hidden")
    })
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true })
      return
    }
    fn()
  }

  // Nested iframes are not pickable; only the top frame gets UI and listeners.
  if (window.top === window) {
    onReady(buildToolbar)
  }
})()`
