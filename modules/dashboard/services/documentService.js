/**
 * modules/dashboard/services/documentService.js
 * 
 * Service managing document attachments and DMS integration.
 * Supports uploads, pins, and version details.
 */

export class DocumentService {
  constructor() {
    this.documents = [
      {
        id: 1,
        name: 'WorkLens_Architecture_v1.pdf',
        size: '1.4 MB',
        uploadedAt: '2026-08-05',
        uploadedBy: 'Karthikeya',
        pinned: true,
        version: 'v3.0'
      },
      {
        id: 2,
        name: 'Redmine_API_Integration_Specs.docx',
        size: '480 KB',
        uploadedAt: '2026-08-06',
        uploadedBy: 'Srinivas',
        pinned: true,
        version: 'v1.1'
      },
      {
        id: 3,
        name: 'Timesheet_Policy_Revision.pdf',
        size: '220 KB',
        uploadedAt: '2026-08-01',
        uploadedBy: 'HR Admin',
        pinned: false,
        version: 'v1.0'
      }
    ];
  }

  async getDocuments() {
    return [...this.documents];
  }

  async uploadDocument(fileName, fileSize) {
    const newDoc = {
      id: Date.now(),
      name: fileName,
      size: fileSize || '120 KB',
      uploadedAt: new Date().toISOString().split('T')[0],
      uploadedBy: 'Self',
      pinned: false,
      version: 'v1.0'
    };
    this.documents.push(newDoc);
    return newDoc;
  }

  async togglePin(docId) {
    const doc = this.documents.find(d => d.id === parseInt(docId));
    if (doc) {
      doc.pinned = !doc.pinned;
      return doc;
    }
    return null;
  }
}
