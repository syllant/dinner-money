export function confirmDelete(label = 'this item'): boolean {
  return window.confirm(`Delete ${label}? This cannot be undone.`)
}
