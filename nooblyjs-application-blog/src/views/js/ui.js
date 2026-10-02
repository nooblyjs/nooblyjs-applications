'use strict';

/**
 * Small shared UI helpers for the blog and the Author Hub, built on Bootstrap's toast and modal.
 */
(function (global) {
  function toastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Shows a short-lived message.
   * @param {string} message
   * @param {'info'|'error'} variant
   */
  function toast(message, variant = 'info') {
    const el = document.createElement('div');
    el.className = `toast align-items-center border-0 ${variant === 'error' ? 'text-bg-danger' : 'text-bg-dark'}`;
    el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    el.innerHTML = `
      <div class="d-flex">
        <div class="toast-body"></div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    el.querySelector('.toast-body').textContent = message;
    toastContainer().appendChild(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    new bootstrap.Toast(el, { delay: 3500 }).show();
  }

  /**
   * Opens a confirmation modal and resolves true when the confirm button is used.
   * @param {{ title: string, body: string, confirmLabel?: string }} options
   * @return {Promise<boolean>}
   */
  function confirm({ title, body, confirmLabel = 'Confirm' }) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'modal fade';
      el.tabIndex = -1;
      el.setAttribute('aria-labelledby', 'confirm-modal-title');
      el.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h2 class="modal-title" id="confirm-modal-title"></h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body"><p class="mb-0"></p></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-danger" data-confirm></button>
            </div>
          </div>
        </div>
      `;
      el.querySelector('.modal-title').textContent = title;
      el.querySelector('.modal-body p').textContent = body;
      el.querySelector('[data-confirm]').textContent = confirmLabel;

      let confirmed = false;
      const modal = new bootstrap.Modal(el);
      el.querySelector('[data-confirm]').addEventListener('click', () => {
        confirmed = true;
        modal.hide();
      });
      el.addEventListener('hidden.bs.modal', () => {
        modal.dispose();
        el.remove();
        resolve(confirmed);
      });
      document.body.appendChild(el);
      modal.show();
    });
  }

  global.BlogUI = { toast, confirm };
})(window);
