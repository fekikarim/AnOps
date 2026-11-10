"use client";

import { useEffect } from "react";

/**
 * Replaces the browser's native validation bubble ("Please select an item in the list.") with an inline,
 * themed message under the field. One listener covers every form: the browser still runs its constraint
 * checks (required, min, pattern, type=email...), but the `invalid` event is intercepted here, so no
 * per-form wiring is needed. Mounted once in the root layout.
 */
const MESSAGE_ATTR = "data-field-error";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function label(field: Field): string {
  const byFor = field.id ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`) : null;
  let found: Element | null = byFor ?? field.closest("label");
  // Labels that are not linked to the input: use the label that sits in the same field cell.
  for (let node: HTMLElement | null = field.parentElement, depth = 0; !found && node && node !== field.form && depth < 3; node = node.parentElement, depth++) {
    if (node.querySelectorAll(CONTROLS).length !== 1) break;
    found = [...node.children].find((child) => child.tagName === "LABEL") ?? null;
  }
  const text = found?.textContent ?? field.getAttribute("aria-label") ?? "";
  return text.replace(/[*:]/g, "").replace(/\s+/g, " ").trim();
}

function copy(field: Field): string {
  const v = field.validity;
  const name = label(field);
  const of = name ? ` for ${name.toLowerCase()}` : "";
  if (v.valueMissing) {
    if (field.type === "checkbox") return "Tick this box to continue.";
    if (field.type === "radio") return "Choose one of the options to continue.";
    if (field instanceof HTMLSelectElement) return name ? `Select ${name.toLowerCase()} to continue.` : "Make a selection to continue.";
    return name ? `${name} is required.` : "This field is required.";
  }
  if (v.typeMismatch) return field.type === "email" ? "Enter a valid email address." : field.type === "url" ? "Enter a valid web address, starting with https://." : `Enter a valid value${of}.`;
  if (v.tooShort) return `Use at least ${field.getAttribute("minlength")} characters.`;
  if (v.tooLong) return `Use at most ${field.getAttribute("maxlength")} characters.`;
  if (v.rangeUnderflow) return `Value must be ${field.getAttribute("min")} or more.`;
  if (v.rangeOverflow) return `Value must be ${field.getAttribute("max")} or less.`;
  if (v.stepMismatch) return "Enter a valid number.";
  if (v.badInput) return `Enter a valid value${of}.`;
  if (v.patternMismatch) return field.title || `Use the requested format${of}.`;
  return field.validationMessage || "This value is not valid.";
}

const CONTROLS = "input:not([type=hidden]),select,textarea";

function clear(field: Field) {
  field.removeAttribute("aria-invalid");
  field.removeAttribute("data-invalid");
  field.style.removeProperty("border-color");
  field.style.removeProperty("box-shadow");
  const id = field.getAttribute(MESSAGE_ATTR);
  if (id) {
    document.getElementById(id)?.remove();
    field.removeAttribute(MESSAGE_ATTR);
    const described = (field.getAttribute("aria-describedby") ?? "").split(" ").filter((part) => part && part !== id);
    if (described.length) field.setAttribute("aria-describedby", described.join(" "));
    else field.removeAttribute("aria-describedby");
  }
}

/**
 * The element the message goes after. It must stay inside the field's own cell (the element that holds the label),
 * otherwise in a grid the message becomes a separate grid item. So we only climb out of a control wrapper
 * (icon / chevron wrapper) while the parent does not hold a label of its own.
 */
function anchorFor(field: Field): HTMLElement {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    const row = field.closest("label");
    if (row) return row;
  }
  let anchor: HTMLElement = field;
  for (let depth = 0; depth < 2; depth++) {
    const parent = anchor.parentElement;
    if (!parent || parent === field.form || parent.tagName === "LABEL") break;
    if (parent.querySelectorAll(CONTROLS).length !== 1) break;
    if ([...parent.children].some((child) => child.tagName === "LABEL")) break; // parent is the cell itself
    anchor = parent;
  }
  return anchor;
}

function show(field: Field) {
  clear(field);
  const id = `fv-${Math.random().toString(36).slice(2, 9)}`;
  const note = document.createElement("p");
  note.id = id;
  note.setAttribute("role", "alert");
  note.className = "anops-field-error";
  // Inline styles keep the message readable even before the stylesheet is applied, on every theme.
  note.style.cssText =
    "display:flex;align-items:flex-start;gap:6px;margin:6px 2px 0;padding:0;font-size:12.5px;line-height:17px;font-weight:600;letter-spacing:0;text-transform:none;" +
    "color:var(--color-status-error-fg,#a43434);box-sizing:border-box;";
  note.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;width:14px;height:14px;margin-top:1.5px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const span = document.createElement("span");
  span.style.cssText = "min-width:0;overflow-wrap:anywhere;";
  span.textContent = copy(field);
  note.appendChild(span);
  anchorFor(field).insertAdjacentElement("afterend", note);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) note.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });

  field.setAttribute("aria-invalid", "true");
  field.setAttribute("data-invalid", "true");
  field.style.setProperty("border-color", "var(--color-status-error, #a43434)", "important");
  field.style.setProperty("box-shadow", "0 0 0 3px color-mix(in srgb, var(--color-status-error, #a43434) 18%, transparent)", "important");
  field.setAttribute(MESSAGE_ATTR, id);
  field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), id].filter(Boolean).join(" "));
}

export function FieldValidationHost() {
  useEffect(() => {
    let firstInForm = new WeakSet<HTMLFormElement>();

    const onInvalid = (event: Event) => {
      const field = event.target as Field;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
      event.preventDefault(); // suppresses the native bubble
      show(field);
      const form = field.form;
      if (form && !firstInForm.has(form)) {
        firstInForm.add(form);
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(() => (firstInForm = new WeakSet()), 0);
      }
    };
    const onEdit = (event: Event) => {
      const field = event.target as Field;
      if (field instanceof HTMLElement && field.hasAttribute(MESSAGE_ATTR)) {
        if (field.checkValidity()) clear(field);
        else show(field);
      }
    };

    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);
  return null;
}
