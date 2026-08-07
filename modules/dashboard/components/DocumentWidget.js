/**
 * modules/dashboard/components/DocumentWidget.js
 * 
 * Widget managing the document workspace.
 * Implements lists, pins, version highlights, and uploads, prepared for future DMS.
 */

import { Widget } from './Widget.js';

export class DocumentWidget extends Widget {
  async init() {
    this.documents = [];
    if (this.services.documentService) {
      this.documents = await this.services.documentService.getDocuments();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="document-widget">
        <div class="widget-header-title">
          <h3>📂 Document Workspace</h3>
        </div>
        <div class="doc-upload-box">
          <input type="file" id="quick-upload-input" style="display:none;">
          <button id="quick-upload-btn" class="action-btn-small">+ Quick Upload</button>
          <span class="upload-label">or drag and drop document</span>
        </div>
        <div class="doc-list">
          ${this.renderDocuments()}
        </div>
        <div class="doc-footer">
          <button id="open-dms-btn" class="link-btn-style">Open DMS Portal</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderDocuments() {
    if (this.documents.length === 0) {
      return `<div class="no-records">No documents uploaded.</div>`;
    }

    return this.documents.map(doc => `
      <div class="doc-item">
        <div class="doc-left">
          <span class="doc-file-icon">📄</span>
          <div class="doc-info">
            <span class="doc-name" title="${doc.name}">${doc.name}</span>
            <span class="doc-meta">${doc.size} • ${doc.uploadedAt} • By ${doc.uploadedBy}</span>
          </div>
        </div>
        <div class="doc-right">
          <span class="doc-version" title="Version History">${doc.version}</span>
          <button class="pin-btn ${doc.pinned ? 'pinned' : ''}" data-id="${doc.id}" title="${doc.pinned ? 'Unpin' : 'Pin'}">
            📌
          </button>
        </div>
      </div>
    `).join('');
  }

  bindEvents() {
    const pinButtons = this.container.querySelectorAll('.pin-btn');
    pinButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const docId = btn.getAttribute('data-id');
        if (this.services.documentService) {
          await this.services.documentService.togglePin(docId);
          await this.init();
          this.render();
        }
      });
    });

    const fileInput = this.container.querySelector('#quick-upload-input');
    const uploadBtn = this.container.querySelector('#quick-upload-btn');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
          const file = e.target.files[0];
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          const sizeStr = sizeMB > 0.1 ? `${sizeMB} MB` : `${Math.round(file.size / 1024)} KB`;
          if (this.services.documentService) {
            await this.services.documentService.uploadDocument(file.name, sizeStr);
            await this.init();
            this.render();
          }
        }
      });
    }

    const openDmsBtn = this.container.querySelector('#open-dms-btn');
    if (openDmsBtn) {
      openDmsBtn.addEventListener('click', () => {
        alert('DMS Portal integration is ready! In a production deployment, this will open the web-based Document Management System.');
      });
    }
  }
}
