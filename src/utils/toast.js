class ToastManager {
  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'toast-container'
    document.body.appendChild(this.container)
  }

  show(message, type = 'info', duration = 2000) {
    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.innerText = message

    this.container.appendChild(toast)

    requestAnimationFrame(() => toast.classList.add('show'))

    setTimeout(() => {
      toast.classList.remove('show')
      toast.addEventListener('transitionend', () => toast.remove())
    }, duration)
  }
}

export const toast = new ToastManager()
