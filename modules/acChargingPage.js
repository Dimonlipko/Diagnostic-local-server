// acChargingPage.js — page-specific event handlers for pages/ac_charging.html.
// Inline <script> tags inside HTML loaded via innerHTML are NOT executed by
// browsers (security feature), so any logic that needs to run when this page
// is loaded must live in a real module that ui.js imports and calls from
// loadPage() after the innerHTML assignment.
//
// Currently this module only handles the "PCS details" modal: open / close /
// Esc / click-on-backdrop.

let escHandler = null;
let backdropHandler = null;

function openModal() {
    const overlay = document.getElementById('pcsDetailsOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeModal() {
    const overlay = document.getElementById('pcsDetailsOverlay');
    if (overlay) overlay.style.display = 'none';
}

export function initAcChargingPage() {
    const openBtn = document.getElementById('pcsDetailsButton');
    const closeBtn = document.getElementById('pcsDetailsCloseButton');
    const overlay = document.getElementById('pcsDetailsOverlay');

    if (!overlay || !openBtn || !closeBtn) {
        // Page wasn't loaded yet, or HTML structure changed — bail out quietly.
        return;
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    // Esc closes the modal
    escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    // Click on the dark backdrop (outside the content box) closes the modal
    backdropHandler = (e) => {
        if (e.target === overlay) closeModal();
    };
    overlay.addEventListener('click', backdropHandler);
}

export function cleanupAcChargingPage() {
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }
    // Other listeners are attached to elements that get destroyed by the next
    // pageContainer.innerHTML assignment, so they don't need explicit removal.
    backdropHandler = null;
}
