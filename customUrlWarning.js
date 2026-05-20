// Shared risk-warning modal for loading custom (non-known) external module
// URLs into the iframe / window panels.
//
// Custom free-text URL entry stays enabled (see the trust model in
// CC/docs/plans/partial/external-iframe-modules.md) but loading a URL that is
// not a knownIframePages / knownWindowPages entry is gated behind this
// acknowledged warning. The warning appears on every custom-URL load unless
// the user ticks "Don't show this warning again", which persists suppression
// to localStorage.

const STORAGE_KEY = 'externalModule.customUrlWarning.suppressed';

/**
 * Whether the user has permanently dismissed the custom-URL warning.
 * @returns {boolean}
 */
export function isCustomUrlWarningSuppressed() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (error) {
        // localStorage unavailable (private mode, etc.) — never suppress.
        return false;
    }
}

/**
 * Persist (or clear) permanent suppression of the custom-URL warning.
 * @param {boolean} suppressed
 */
export function setCustomUrlWarningSuppressed(suppressed) {
    try {
        if (suppressed) {
            localStorage.setItem(STORAGE_KEY, 'true');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        // Best-effort; ignore storage failures.
    }
}

/**
 * Show the custom-URL risk warning. Resolves true if the user chooses to load
 * anyway, false if they cancel. If the user has previously ticked "Don't show
 * again", resolves true immediately without showing a modal.
 *
 * @param {string} url - the custom URL about to be loaded
 * @param {'iframe'|'window'} kind - affects wording only
 * @returns {Promise<boolean>}
 */
export function confirmCustomUrlLoad(url, kind = 'iframe') {
    if (isCustomUrlWarningSuppressed()) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const target = kind === 'window' ? 'window' : 'iframe';

        const overlay = document.createElement('div');
        overlay.className = 'custom-url-warning-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '100000',
        });

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            background: '#2d2d30',
            color: '#cccccc',
            border: '1px solid #f0ad4e',
            borderRadius: '6px',
            padding: '20px',
            maxWidth: '460px',
            width: 'calc(100% - 40px)',
            fontSize: '13px',
            lineHeight: '1.5',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        });

        const heading = document.createElement('h3');
        heading.textContent = '⚠️ Load a custom URL?';
        Object.assign(heading.style, {
            margin: '0 0 12px 0',
            fontSize: '15px',
            color: '#f0ad4e',
        });

        const body = document.createElement('p');
        body.style.margin = '0 0 12px 0';
        body.textContent =
            `This URL is not one of the known module pages. Loading it will run ` +
            `its code in this app's ${target} with access to the adapter bridge. ` +
            `Only continue if you trust the source of this URL.`;

        const urlBox = document.createElement('div');
        urlBox.textContent = url;
        Object.assign(urlBox.style, {
            background: '#1e1e1e',
            border: '1px solid #555',
            borderRadius: '4px',
            padding: '8px',
            margin: '0 0 14px 0',
            fontFamily: 'monospace',
            fontSize: '12px',
            wordBreak: 'break-all',
            color: '#dddddd',
        });

        const checkboxLabel = document.createElement('label');
        Object.assign(checkboxLabel.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            margin: '0 0 16px 0',
            fontSize: '12px',
            cursor: 'pointer',
        });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-url-warning-suppress';
        const checkboxText = document.createElement('span');
        checkboxText.textContent = "Don't show this warning again";
        checkboxLabel.appendChild(checkbox);
        checkboxLabel.appendChild(checkboxText);

        const buttonRow = document.createElement('div');
        Object.assign(buttonRow.style, {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
        });

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.className = 'custom-url-warning-cancel';
        Object.assign(cancelButton.style, {
            padding: '8px 16px',
            background: '#555',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
        });

        const loadButton = document.createElement('button');
        loadButton.textContent = 'Load anyway';
        loadButton.className = 'custom-url-warning-confirm';
        Object.assign(loadButton.style, {
            padding: '8px 16px',
            background: '#f0ad4e',
            color: '#1e1e1e',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
        });

        buttonRow.appendChild(cancelButton);
        buttonRow.appendChild(loadButton);

        dialog.appendChild(heading);
        dialog.appendChild(body);
        dialog.appendChild(urlBox);
        dialog.appendChild(checkboxLabel);
        dialog.appendChild(buttonRow);
        overlay.appendChild(dialog);

        let settled = false;
        const finish = (confirmed) => {
            if (settled) return;
            settled = true;
            if (confirmed && checkbox.checked) {
                setCustomUrlWarningSuppressed(true);
            }
            document.removeEventListener('keydown', onKeyDown, true);
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            resolve(confirmed);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        };

        cancelButton.addEventListener('click', () => finish(false));
        loadButton.addEventListener('click', () => finish(true));
        // Click on the dark backdrop (outside the dialog) cancels.
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish(false);
        });
        document.addEventListener('keydown', onKeyDown, true);

        document.body.appendChild(overlay);
        loadButton.focus();
    });
}
