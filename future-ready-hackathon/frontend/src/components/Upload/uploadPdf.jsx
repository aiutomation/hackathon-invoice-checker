// uploadPdf.jsx
import React, { useCallback, useMemo, useRef, useState } from 'react';
import api from '../../api';
import './upload.css';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { MdDelete, MdPictureAsPdf, MdVisibility, MdEmail } from 'react-icons/md';
import {
  makeValidationPdfBlob,
  openValidationPdf,
  downloadValidationPdf,
} from '../Create-PDF/create-pdf';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    table: [...(defaultSchema.attributes?.table || []), ['table', 'align'], ['table', 'width']],
    td: [
      ...(defaultSchema.attributes?.td || []),
      ['td', 'colspan'],
      ['td', 'rowspan'],
      ['td', 'align'],
    ],
    th: [
      ...(defaultSchema.attributes?.th || []),
      ['th', 'colspan'],
      ['th', 'rowspan'],
      ['th', 'align'],
    ],
  },
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value > 100 ? 0 : 2)} ${sizes[i]}`;
};

const isPdf = (file) =>
  file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

const containsTable = (markdown) => {
  if (!markdown) return false;
  return /\n\s*\|.+\|\s*\n/.test(markdown) || /<table[\s>]/i.test(markdown);
};

const mdComponents = {
  table: ({ node, ...props }) => <table className="md-table" {...props} />,
  thead: ({ node, ...props }) => <thead className="md-thead" {...props} />,
  tbody: ({ node, ...props }) => <tbody className="md-tbody" {...props} />,
  tr: ({ node, ...props }) => <tr className="md-tr" {...props} />,
  th: ({ node, ...props }) => <th className="md-th" {...props} />,
  td: ({ node, ...props }) => <td className="md-td" {...props} />,
  ul: ({ node, ...props }) => <ul className="md-ul" {...props} />,
  ol: ({ node, ...props }) => <ol className="md-ol" {...props} />,
  li: ({ node, ...props }) => <li className="md-li" {...props} />,
  img: ({ node, ...props }) => <img style={{ maxWidth: '100%', height: 'auto' }} {...props} />,
  p: ({ node, ...props }) => <p style={{ textAlign: 'left' }} {...props} />,
  h1: ({ node, ...props }) => <h1 style={{ textAlign: 'left' }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ textAlign: 'left' }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ textAlign: 'left' }} {...props} />,
  h4: ({ node, ...props }) => <h4 style={{ textAlign: 'left' }} {...props} />,
  h5: ({ node, ...props }) => <h5 style={{ textAlign: 'left' }} {...props} />,
  h6: ({ node, ...props }) => <h6 style={{ textAlign: 'left' }} {...props} />,
};

const mkId = () => Math.random().toString(36).slice(2);

const UploadPdf = () => {
  // upload selection (pre-submit)
  const [selectedFiles, setSelectedFiles] = useState([]); // File[]
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const inputRef = useRef(null);

  // request progress / status
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState(null); // { type, message }

  // tabs
  const [activeTab, setActiveTab] = useState('markdown');

  // persistent ledger of uploaded files (until "Clear History")
  // Each file entry: { id, batchId, fileNumber, originalName, summary, markdown_pages, structured_data, extractions }
  const [uploads, setUploads] = useState([]);
  const [batches, setBatches] = useState([]); // [{id, label}]
  const [currentBatchId, setCurrentBatchId] = useState(null);
  const [nextFileNumber, setNextFileNumber] = useState(1);

  // editable fields per fileId + table editing state
  // editableFieldsPerFile[fileId] = [{ id, label, text }]
  const [editableFieldsPerFile, setEditableFieldsPerFile] = useState({});
  const [editingCell, setEditingCell] = useState(null); // { fileId, fieldId, column }

  // validation history (PDFs + metadata)
  const [validationHistory, setValidationHistory] = useState([]);

  // email modal
  const [emailForm, setEmailForm] = useState({
    show: false,
    validationId: null,
    email: '',
    subject: '',
    message: '',
  });

  // helpers
  const handleFiles = useCallback((fileOrList) => {
    const files = Array.from(fileOrList?.length != null ? fileOrList : [fileOrList]);
    const pdfs = files.filter(isPdf);
    if (pdfs.length === 0) {
      setStatus({ type: 'error', message: 'Only PDF files are accepted.' });
      return;
    }
    setStatus(null);
    setSelectedFiles((prev) => {
      const map = new Map(prev.map((f) => [f.name + ':' + f.size, f])); // de-dupe
      pdfs.forEach((f) => map.set(f.name + ':' + f.size, f));
      return Array.from(map.values());
    });
    setIsConfirmed(false);
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length) handleFiles(files);
  };

  const onBrowse = (e) => {
    const files = e.target.files;
    if (files && files.length) handleFiles(files);
  };

  const removeFileAt = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setIsConfirmed(false);
  };
  const clearAll = () => {
    setSelectedFiles([]);
    setIsConfirmed(false);
  };

  // group files for current batch
  const currentFiles = useMemo(
    () => uploads.filter((f) => f.batchId === currentBatchId),
    [uploads, currentBatchId]
  );

  // upload -> appends a persistent batch to "uploads"
  const upload = async () => {
    if (!selectedFiles.length || !isConfirmed) return;
    setStatus(null);
    setUploadProgress(0);
    setIsUploading(true);

    try {
      const formData = new FormData();
      selectedFiles.forEach((f) => formData.append('files', f));

      const res = await api.post('/upload-pdf', formData, {
        onUploadProgress: (evt) => {
          if (!evt?.total) return;
          setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });

      const results = res?.data?.results || [];
      const batchId = mkId();

      const newFiles = results.map((r, i) => {
        const id = mkId();
        const fileNumber = nextFileNumber + i;
        const originalName = `Invoice-${fileNumber}`;
        return {
          id,
          batchId,
          fileNumber,
          originalName,
          summary: r?.summary || '',
          markdown_pages: r?.markdown_pages || [],
          structured_data: r?.structured_data,
          extractions: r?.extractions || [],
        };
      });

      // seed editable fields from extractions (dedup by label)
      const seededEditable = {};
      newFiles.forEach((file) => {
        const initial = [];
        const seen = new Set();
        (file.extractions || []).forEach((item) => {
          const label =
            item?.extraction_class || item?.class || item?.label || item?.name || '';
          const text =
            item?.extraction_text || item?.text || item?.value || item?.content || '';
          if (label && text && !seen.has(label)) {
            seen.add(label);
            initial.push({ id: mkId(), label, text });
          }
        });
        seededEditable[file.id] = initial;
      });

      setUploads((prev) => [...prev, ...newFiles]);
      setEditableFieldsPerFile((prev) => ({ ...prev, ...seededEditable }));
      setCurrentBatchId(batchId);
      setNextFileNumber((prev) => prev + newFiles.length);
      setBatches((prev) => [
        ...prev,
        { id: batchId, label: `Batch ${prev.length + 1} (${newFiles.length} file${newFiles.length > 1 ? 's' : ''})` },
      ]);

      setStatus({ type: 'success', message: `Uploaded ${newFiles.length} file(s) successfully` });
      setActiveTab('markdown');
      setSelectedFiles([]);
      setIsConfirmed(false);
    } catch (error) {
      const message =
        (error.response && error.response.data && error.response.data.detail) ||
        error.message ||
        'Upload failed';
      setStatus({ type: 'error', message });
    } finally {
      setIsUploading(false);
    }
  };

  // coverage table handlers (keyed by fileId)
  const handleCellEdit = (fileId, fieldId, column, value) => {
    setEditableFieldsPerFile((prev) => ({
      ...prev,
      [fileId]: (prev[fileId] || []).map((f) => (f.id === fieldId ? { ...f, [column]: value } : f)),
    }));
  };

  const addNewRow = (fileId) => {
    const newField = { id: mkId(), label: '', text: '' };
    setEditableFieldsPerFile((prev) => ({
      ...prev,
      [fileId]: [...(prev[fileId] || []), newField],
    }));
    setTimeout(() => {
      setEditingCell({ fileId, fieldId: newField.id, column: 'label' });
    }, 10);
  };

  const deleteRow = (fileId, fieldId) => {
    setEditableFieldsPerFile((prev) => ({
      ...prev,
      [fileId]: (prev[fileId] || []).filter((f) => f.id !== fieldId),
    }));
  };

  // email modal helpers
  const openEmailForm = (validationId, fileName) => {
    setEmailForm({
      show: true,
      validationId,
      email: '',
      subject: `E-Invoice Validation Report - ${fileName}`,
      message:
        `Please find attached the e-invoice validation report for ${fileName}.\n\n` +
        `This report contains detailed analysis of extracted fields and compliance status.\n\n` +
        `Best regards`,
    });
  };

  const closeEmailForm = () => {
    setEmailForm({ show: false, validationId: null, email: '', subject: '', message: '' });
  };

  const sendEmail = async () => {
    try {
      const validation = validationHistory.find((v) => v.id === emailForm.validationId);
      if (!validation) {
        alert('Validation not found');
        return;
      }

      // Convert PDF blob to base64
      const pdfBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(validation.pdfBlob);
      });

      const emailData = {
        to: emailForm.email,
        subject: emailForm.subject,
        message: emailForm.message,
        attachment: {
          filename: `validation-report-${validation.fileName.replace(' ', '-')}-${Date.now()}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf',
        },
        validationData: {
          fileName: validation.fileName,
          timestamp: validation.timestamp,
          totalExtracted: validation.totalExtracted,
          fieldsIdentified: validation.fieldsIdentified,
          completionRate: validation.completionRate,
        },
      };

      const response = await fetch(
        'https://n8n-ks-2.app.n8n.cloud/webhook/039d967d-3767-4bda-8689-5da13bde7d80',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailData),
        }
      );

      if (response.ok) {
        alert(`Email sent successfully to ${emailForm.email}!`);
        closeEmailForm();
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending email:', error);
      alert(`Error sending email: ${error.message}. Please try again.`);
    }
  };

  return (
    <section className="upload">
      {/* Dropzone */}
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={onBrowse}
          hidden
        />
        <div className="dropzone-inner">
          <div className="icon">📄</div>
          <div className="title">Drag and drop your PDF(s) here</div>
          <div className="subtitle">or click to browse</div>
        </div>
      </div>

      {/* Selected files preview + actions (stays near dropzone) */}
      {selectedFiles.length > 0 && (
        <div>
          <div className="file-list">
            {selectedFiles.map((f, idx) => (
              <div className="file-item" key={f.name + ':' + f.size}>
                <div>
                  <div className="file-name">{f.name}</div>
                  <div className="file-meta">{formatBytes(f.size)}</div>
                </div>
                <button
                  className="remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFileAt(idx);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="confirm-row">
            <label className="confirm-label">
              <input
                type="checkbox"
                checked={isConfirmed}
                onChange={(e) => setIsConfirmed(e.target.checked)}
              />
              <span> I confirm I am done selecting files</span>
            </label>
            <div className="actions-row">
              <button className="link-btn clear-btn" onClick={clearAll}>
                Clear all
              </button>
              <button className="primary-btn" onClick={upload} disabled={isUploading || !isConfirmed}>
                {isUploading ? 'Uploading…' : `Upload ${selectedFiles.length} file(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress (still near dropzone) */}
      {(isUploading || (uploadProgress > 0 && uploadProgress < 100)) && (
        <div className="progress uploading">
          <div className="bar" style={{ width: `${uploadProgress}%` }} />
          <div className="percent">{uploadProgress}%</div>
        </div>
      )}

      {/* Status banner */}
      {status?.message && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${status.type === 'error' ? '#da3633' : '#2da44e'}`,
            background: status.type === 'error' ? '#fff5f5' : '#f0fff4',
            color: status.type === 'error' ? '#b42318' : '#065f46',
          }}
        >
          {status.message}
        </div>
      )}

      {/* Batch switcher (if multiple batches exist) */}
      {batches.length > 1 && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#656d76' }}>Showing:</span>
          <select
            value={currentBatchId || ''}
            onChange={(e) => setCurrentBatchId(e.target.value)}
            style={{
              padding: '6px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ===================== PARSED RESULTS — MOVED HERE ===================== */}
      {(currentFiles.length > 0 || validationHistory.length > 0) && (
        <div className="parsed-results" style={{ marginTop: 16 }}>
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'markdown' ? 'active' : ''}`}
              onClick={() => setActiveTab('markdown')}
            >
              Markdown
            </button>
            {currentFiles.some((f) => f.structured_data !== undefined || f.extractions !== undefined) && (
              <button
                className={`tab ${activeTab === 'json' ? 'active' : ''}`}
                onClick={() => setActiveTab('json')}
              >
                JSON
              </button>
            )}
            {currentFiles.some((f) => f.structured_data && f.extractions) && (
              <button
                className={`tab ${activeTab === 'coverage' ? 'active' : ''}`}
                onClick={() => setActiveTab('coverage')}
              >
                Coverage
              </button>
            )}
            <button
              className={`tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History
            </button>
          </div>

          <div className="tab-content">
            {/* MARKDOWN */}
            {activeTab === 'markdown' && (
              <div className="markdown-pages">
                {currentFiles.map((file) => (
                  <div key={file.id} className="markdown-file">
                    <h4>{file.originalName}</h4>
                    {file.markdown_pages.map((page, idx) => {
                      const hasTable = containsTable(page);
                      return (
                        <div key={idx} className="markdown-page">
                          <h5>Page {idx + 1}</h5>
                          <div className={`markdown-content ${hasTable ? 'has-table' : 'no-table'}`}>
                            <ReactMarkdown
                              components={mdComponents}
                              remarkPlugins={[remarkGfm, remarkBreaks]}
                              rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
                            >
                              {page}
                            </ReactMarkdown>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* JSON */}
            {activeTab === 'json' && (
              <div className="json-preview">
                {currentFiles.map((file) => (
                  <div key={file.id} className="json-block">
                    <h4>{file.originalName}</h4>

                    {file.structured_data !== undefined && (
                      <div style={{ marginBottom: 12 }}>
                        <h5>Structured Data</h5>
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            backgroundColor: '#f6f8fa',
                            padding: '1em',
                            borderRadius: '6px',
                            overflowX: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                          }}
                        >
                          {JSON.stringify(file.structured_data, null, 2)}
                        </pre>
                      </div>
                    )}

                    {file.extractions !== undefined && (
                      <div>
                        <h5>Extractions</h5>
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            backgroundColor: '#f6f8fa',
                            padding: '1em',
                            borderRadius: '6px',
                            overflowX: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                          }}
                        >
                          {JSON.stringify(file.extractions, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* COVERAGE */}
            {activeTab === 'coverage' && (
              <div className="coverage-preview">
                {currentFiles.map((file) => {
                  const editableFields = editableFieldsPerFile[file.id] || [];
                  const sd = file.structured_data;

                  const saveValidation = async () => {
                    const validationData = {
                      id: Date.now() + Math.random(),
                      timestamp: new Date().toLocaleString(),
                      fileName: file.originalName,
                      totalExtracted: editableFields.length,
                      fieldsIdentified: sd?.summary?.fields_present || 0,
                      completionRate: sd?.summary?.completion_percentage || 0,
                      extractedFields: editableFields.map((field) => ({
                        name: field.label,
                        value: field.text,
                        isMandatory: sd?.mandatory_fields?.[field.label]?.present === true,
                      })),
                      missingFields: Object.entries(sd?.mandatory_fields || {})
                        .filter(([_, field]) => !field.present)
                        .map(([fieldName]) => fieldName),
                    };

                    try {
                      const pdfBlob = makeValidationPdfBlob(validationData, { totalMandatory: 34 });
                      const pdfUrl = URL.createObjectURL(pdfBlob);
                      setValidationHistory((prev) => [
                        { ...validationData, pdfUrl, pdfBlob, isPdf: true },
                        ...prev,
                      ]);
                    } catch (err) {
                      console.error('Error generating PDF:', err);
                      alert('Error generating PDF report. Please try again.');
                    }
                  };

                  return (
                    <div key={file.id} className="coverage-block" style={{ marginBottom: '16px' }}>
                      <h4>{file.originalName}</h4>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginBottom: '16px',
                        }}
                      >
                        <div className="summary-stats" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <div className="stat-card">
                            <h5>Total Extracted Fields</h5>
                            <p>{editableFields.length}</p>
                            <small style={{ color: '#656d76', fontSize: '11px' }}>(Unique fields from PDF)</small>
                          </div>

                          <div className="stat-card">
                            <h5>Total Mandatory Fields</h5>
                            <p>34</p>
                            <small style={{ color: '#656d76', fontSize: '11px' }}>(Required by e-invoice)</small>
                          </div>

                          {sd?.summary && (
                            <>
                              <div className="stat-card">
                                <h5>Fields Identified</h5>
                                <p>{sd.summary.fields_present}</p>
                                <small style={{ color: '#656d76', fontSize: '11px' }}>(Mandatory fields found)</small>
                              </div>
                              <div className="stat-card">
                                <h5>Completion Rate</h5>
                                <p
                                  style={{
                                    color:
                                      sd.summary.completion_percentage >= 70
                                        ? '#2da44e'
                                        : sd.summary.completion_percentage >= 40
                                        ? '#fb8500'
                                        : '#da3633',
                                  }}
                                >
                                  {sd.summary.completion_percentage}%
                                </p>
                              </div>
                            </>
                          )}
                        </div>

                        <button
                          onClick={saveValidation}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: '#0969da',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => (e.target.style.backgroundColor = '#0860ca')}
                          onMouseLeave={(e) => (e.target.style.backgroundColor = '#0969da')}
                          title="Save current validation results to history"
                        >
                          💾 Save Validation
                        </button>
                      </div>

                      {editableFields.length > 0 && (
                        <div style={{ marginTop: '16px' }}>
                          <h5>Extracted Fields</h5>
                          <div style={{ overflowX: 'auto' }}>
                            <table
                              style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                marginTop: '8px',
                                border: '1px solid #e1e5e9',
                                borderRadius: '6px',
                              }}
                            >
                              <thead>
                                <tr style={{ backgroundColor: '#f6f8fa' }}>
                                  <th
                                    style={{
                                      padding: '12px 16px',
                                      textAlign: 'center',
                                      borderBottom: '1px solid #e1e5e9',
                                      fontWeight: '600',
                                      color: '#24292f',
                                      width: '60px',
                                      borderRight: '1px solid #e1e5e9',
                                    }}
                                  >
                                    No
                                  </th>
                                  <th
                                    style={{
                                      padding: '12px 16px',
                                      textAlign: 'left',
                                      borderBottom: '1px solid #e1e5e9',
                                      fontWeight: '600',
                                      color: '#24292f',
                                      width: '35%',
                                      borderRight: '1px solid #e1e5e9',
                                    }}
                                  >
                                    Field Name
                                    <div
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 'normal',
                                        color: '#656d76',
                                        marginTop: '2px',
                                      }}
                                    >
                                      🟢 = Mandatory | 🔵 = Additional
                                    </div>
                                  </th>
                                  <th
                                    style={{
                                      padding: '12px 16px',
                                      textAlign: 'left',
                                      borderBottom: '1px solid #e1e5e9',
                                      fontWeight: '600',
                                      color: '#24292f',
                                      borderRight: '1px solid #e1e5e9',
                                    }}
                                  >
                                    Extracted Value
                                  </th>
                                  <th
                                    style={{
                                      padding: '12px 16px',
                                      textAlign: 'center',
                                      borderBottom: '1px solid #e1e5e9',
                                      fontWeight: '600',
                                      color: '#24292f',
                                      width: '80px',
                                    }}
                                  >
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {editableFields.map((field, fieldIdx) => (
                                  <tr
                                    key={field.id}
                                    style={{
                                      borderBottom: fieldIdx < editableFields.length - 1 ? '1px solid #e1e5e9' : 'none',
                                    }}
                                  >
                                    <td
                                      style={{
                                        padding: '12px 16px',
                                        textAlign: 'center',
                                        fontWeight: '500',
                                        color: '#656d76',
                                        verticalAlign: 'top',
                                        borderRight: '1px solid #e1e5e9',
                                      }}
                                    >
                                      {fieldIdx + 1}
                                    </td>

                                    {/* Field Name */}
                                    <td
                                      style={{
                                        padding: '8px',
                                        verticalAlign: 'top',
                                        borderRight: '1px solid #e1e5e9',
                                      }}
                                    >
                                      {editingCell?.fileId === file.id &&
                                      editingCell?.fieldId === field.id &&
                                      editingCell?.column === 'label' ? (
                                        <input
                                          type="text"
                                          value={field.label}
                                          onChange={(e) => handleCellEdit(file.id, field.id, 'label', e.target.value)}
                                          onBlur={() => setEditingCell(null)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') setEditingCell(null);
                                            if (e.key === 'Escape') setEditingCell(null);
                                          }}
                                          autoFocus
                                          style={{
                                            width: '100%',
                                            padding: '8px',
                                            border: '1px solid #0969da',
                                            borderRadius: '4px',
                                            fontSize: '14px',
                                          }}
                                        />
                                      ) : (
                                        <div
                                          onClick={() => setEditingCell({ fileId: file.id, fieldId: field.id, column: 'label' })}
                                          style={{
                                            padding: '8px',
                                            cursor: 'pointer',
                                            fontWeight: '500',
                                            color: '#24292f',
                                            minHeight: '20px',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                          }}
                                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6f8fa')}
                                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                        >
                                          {(() => {
                                            const isMandatory =
                                              sd?.mandatory_fields?.[field.label]?.present === true;
                                            const isInMandatoryList =
                                              sd?.mandatory_fields &&
                                              Object.prototype.hasOwnProperty.call(sd.mandatory_fields, field.label);
                                            if (isMandatory) {
                                              return (
                                                <>
                                                  <span style={{ fontSize: '12px' }}>🟢</span> {field.label || 'Click to edit...'}
                                                </>
                                              );
                                            } else if (isInMandatoryList) {
                                              return (
                                                <>
                                                  <span style={{ fontSize: '12px' }}>🔴</span> {field.label || 'Click to edit...'}
                                                </>
                                              );
                                            } else {
                                              return (
                                                <>
                                                  <span style={{ fontSize: '12px' }}>🔵</span> {field.label || 'Click to edit...'}
                                                </>
                                              );
                                            }
                                          })()}
                                        </div>
                                      )}
                                    </td>

                                    {/* Extracted Value */}
                                    <td
                                      style={{
                                        padding: '8px',
                                        verticalAlign: 'top',
                                        borderRight: '1px solid #e1e5e9',
                                      }}
                                    >
                                      {editingCell?.fileId === file.id &&
                                      editingCell?.fieldId === field.id &&
                                      editingCell?.column === 'text' ? (
                                        <input
                                          type="text"
                                          value={field.text}
                                          onChange={(e) => handleCellEdit(file.id, field.id, 'text', e.target.value)}
                                          onBlur={() => setEditingCell(null)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') setEditingCell(null);
                                            if (e.key === 'Escape') setEditingCell(null);
                                          }}
                                          autoFocus
                                          style={{
                                            width: '100%',
                                            padding: '8px',
                                            border: '1px solid #0969da',
                                            borderRadius: '4px',
                                            fontSize: '14px',
                                          }}
                                        />
                                      ) : (
                                        <div
                                          onClick={() => setEditingCell({ fileId: file.id, fieldId: field.id, column: 'text' })}
                                          style={{
                                            padding: '8px',
                                            cursor: 'pointer',
                                            color: '#656d76',
                                            minHeight: '20px',
                                            wordBreak: 'break-word',
                                            borderRadius: '4px',
                                          }}
                                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6f8fa')}
                                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                        >
                                          {field.text || 'Click to edit...'}
                                        </div>
                                      )}
                                    </td>

                                    {/* Actions */}
                                    <td
                                      style={{
                                        padding: '12px 16px',
                                        textAlign: 'right',
                                        verticalAlign: 'top',
                                      }}
                                    >
                                      <button
                                        onClick={() => deleteRow(file.id, field.id)}
                                        style={{
                                          backgroundColor: '#da3633',
                                          border: 'none',
                                          color: 'white',
                                          cursor: 'pointer',
                                          fontSize: '16px',
                                          padding: '8px',
                                          borderRadius: '4px',
                                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#b91c1c')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#da3633')}
                                        title="Delete row"
                                      >
                                        <MdDelete />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Add New Field */}
                          <div style={{ marginTop: '12px', textAlign: 'right' }}>
                            <button
                              onClick={() => addNewRow(file.id)}
                              style={{
                                padding: '10px 20px',
                                backgroundColor: '#2da44e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: '500',
                                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2c974b')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2da44e')}
                            >
                              + Add New Field
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Show Add Button even with no fields */}
                      {editableFields.length === 0 && (
                        <div style={{ marginTop: '16px', textAlign: 'right' }}>
                          <button
                            onClick={() => addNewRow(file.id)}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: '#2da44e',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '500',
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2c974b')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2da44e')}
                          >
                            + Add New Field
                          </button>
                        </div>
                      )}

                      {/* Missing fields summary */}
                      {sd?.summary && sd.summary.fields_missing > 0 && (
                        <div
                          style={{
                            marginTop: '20px',
                            padding: '16px',
                            backgroundColor: '#fff8f0',
                            border: '2px solid #fb8500',
                            borderRadius: '8px',
                          }}
                        >
                          <h6
                            style={{
                              fontSize: '16px',
                              fontWeight: 'bold',
                              color: '#fb8500',
                              marginBottom: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            ⚠️ Missing Fields Summary ({sd.summary.fields_missing} fields)
                          </h6>

                          <p style={{ fontSize: '14px', marginBottom: '16px', color: '#8b5a00' }}>
                            The following mandatory e-invoice fields were not found in your document:
                          </p>

                          <div
                            style={{
                              backgroundColor: '#fff',
                              padding: '16px',
                              borderRadius: '6px',
                              border: '1px solid #e1e5e9',
                            }}
                          >
                            <h6
                              style={{
                                fontSize: '14px',
                                fontWeight: 'bold',
                                marginBottom: '12px',
                                color: '#da3633',
                                borderBottom: '1px solid #e1e5e9',
                                paddingBottom: '4px',
                              }}
                            >
                              Missing Mandatory Fields ({sd.summary.fields_missing})
                            </h6>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                                gap: '8px',
                              }}
                            >
                              {Object.entries(sd?.mandatory_fields || {})
                                .filter(([_, field]) => !field.present)
                                .map(([fieldName]) => (
                                  <div
                                    key={fieldName}
                                    style={{
                                      fontSize: '12px',
                                      padding: '8px',
                                      backgroundColor: '#fff5f5',
                                      borderRadius: '4px',
                                      border: '1px solid #fed7d7',
                                      color: '#744210',
                                      lineHeight: '1.4',
                                    }}
                                  >
                                    {fieldName}
                                  </div>
                                ))}
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: '16px',
                              padding: '12px',
                              backgroundColor: '#f0f6ff',
                              borderRadius: '6px',
                              border: '1px solid #0969da',
                            }}
                          >
                            <p
                              style={{
                                fontSize: '13px',
                                margin: 0,
                                color: '#0969da',
                                fontWeight: '500',
                              }}
                            >
                              💡 <strong>Tip:</strong> To improve compliance, ensure your PDF contains these missing fields.
                              You can also manually add them using the "Add New Field" button above.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* HISTORY */}
            {activeTab === 'history' && (
              <div className="history-tab">
                {validationHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#656d76' }}>
                    <h4>No Validation History</h4>
                    <p>Save validation results from the Coverage tab to see them here.</p>
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '20px',
                      }}
                    >
                      <h4>Validation History ({validationHistory.length})</h4>
                      <button
                        onClick={() => {
                          setValidationHistory([]);
                          setUploads([]);
                          setEditableFieldsPerFile({});
                          setCurrentBatchId(null);
                          setBatches([]);
                          setNextFileNumber(1);
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#da3633',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '500',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#b91c1c')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#da3633')}
                      >
                        Clear History
                      </button>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gap: '16px',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                      }}
                    >
                      {validationHistory.map((validation) => (
                        <div
                          key={validation.id}
                          style={{
                            border: '1px solid #e1e5e9',
                            borderRadius: '8px',
                            padding: '16px',
                            backgroundColor: '#fff',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '12px',
                            }}
                          >
                            <h5 style={{ margin: 0, color: '#24292f' }}>{validation.fileName}</h5>
                            <small style={{ color: '#656d76' }}>{validation.timestamp}</small>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(2, 1fr)',
                              gap: '8px',
                              marginBottom: '12px',
                            }}
                          >
                            <div
                              style={{
                                padding: '8px',
                                backgroundColor: '#f6f8fa',
                                borderRadius: '4px',
                                textAlign: 'center',
                              }}
                            >
                              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#24292f' }}>
                                {validation.totalExtracted}
                              </div>
                              <div style={{ fontSize: '11px', color: '#656d76' }}>Total Extracted</div>
                            </div>
                            <div
                              style={{
                                padding: '8px',
                                backgroundColor: '#f6f8fa',
                                borderRadius: '4px',
                                textAlign: 'center',
                              }}
                            >
                              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#24292f' }}>
                                {validation.fieldsIdentified}
                              </div>
                              <div style={{ fontSize: '11px', color: '#656d76' }}>Fields Identified</div>
                            </div>
                          </div>

                          <div
                            style={{
                              padding: '12px',
                              backgroundColor:
                                validation.completionRate >= 70
                                  ? '#f0f9ff'
                                  : validation.completionRate >= 40
                                  ? '#fff8f0'
                                  : '#fff5f5',
                              border: `1px solid ${
                                validation.completionRate >= 70
                                  ? '#2da44e'
                                  : validation.completionRate >= 40
                                  ? '#fb8500'
                                  : '#da3633'
                              }`,
                              borderRadius: '6px',
                              textAlign: 'center',
                              marginBottom: '12px',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '24px',
                                fontWeight: 'bold',
                                color:
                                  validation.completionRate >= 70
                                    ? '#2da44e'
                                    : validation.completionRate >= 40
                                    ? '#fb8500'
                                    : '#da3633',
                              }}
                            >
                              {validation.completionRate}%
                            </div>
                            <div style={{ fontSize: '12px', color: '#656d76' }}>Completion Rate</div>
                          </div>

                          {validation.missingFields.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                              <h6
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  color: '#da3633',
                                  marginBottom: '6px',
                                }}
                              >
                                Missing Fields ({validation.missingFields.length}):
                              </h6>
                              <div
                                style={{
                                  maxHeight: '100px',
                                  overflowY: 'auto',
                                  fontSize: '11px',
                                  color: '#656d76',
                                  lineHeight: '1.3',
                                }}
                              >
                                {validation.missingFields.slice(0, 10).join(', ')}
                                {validation.missingFields.length > 10 && '...'}
                              </div>
                            </div>
                          )}

                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              justifyContent: 'flex-end',
                              borderTop: '1px solid #e1e5e9',
                              paddingTop: '12px',
                            }}
                          >
                            <button
                              onClick={() => {
                                if (validation.isPdf && validation.pdfUrl) {
                                  window.open(validation.pdfUrl, '_blank', 'noopener,noreferrer');
                                } else {
                                  openValidationPdf(validation, `validation-report-${validation.fileName}`);
                                }
                              }}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#0969da',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0860ca')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0969da')}
                              title="View PDF validation report"
                            >
                              <MdVisibility size={14} /> View PDF
                            </button>
                            <button
                              onClick={() => openEmailForm(validation.id, validation.fileName)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#8b5cf6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#7c3aed')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8b5cf6')}
                              title="Send validation report via email"
                            >
                              <MdEmail size={14} /> Send Email
                            </button>
                            <button
                              onClick={() =>
                                downloadValidationPdf(
                                  validation,
                                  `validation-report-${validation.fileName.replace(' ', '-')}-${Date.now()}.pdf`
                                )
                              }
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#2da44e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2c974b')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2da44e')}
                              title="Download PDF validation report"
                            >
                              <MdPictureAsPdf size={14} /> Download PDF
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* =================== END PARSED RESULTS (now above features) =================== */}

      {/* ===== Features Section (now BELOW parsed results) ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          marginTop: '32px',
          padding: '24px 0',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: '#e0e7ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '24px',
            }}
          >
            🤖
          </div>
          <h4
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '12px',
            }}
          >
            Powerful AI engine
          </h4>
          <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.5', margin: 0 }}>
            Advanced AI extracts invoice fields automatically from PDFs using state-of-the-art
            language models for accurate data recognition.
          </p>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: '#fce7f3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '24px',
            }}
          >
            ⚡
          </div>
          <h4
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '12px',
            }}
          >
            E-Invoice compliance
          </h4>
          <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.5', margin: 0 }}>
            Automatically validates against 34 mandatory e-invoice fields required by Malaysian tax
            authorities for full compliance.
          </p>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: '#f0fdf4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '24px',
            }}
          >
            📊
          </div>
          <h4
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#1f2937',
              marginBottom: '12px',
            }}
          >
            Professional reports
          </h4>
          <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.5', margin: 0 }}>
            Generate detailed PDF reports with compliance analysis, missing fields identification,
            and professional formatting for sharing.
          </p>
        </div>
      </div>

      {/* ===== How It Works Section (still below features) ===== */}
      <div
        style={{
          marginTop: '48px',
          padding: '32px 0',
          backgroundColor: '#f9fafb',
          borderRadius: '12px',
          marginBottom: '32px',
        }}
      >
        {/* Section Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div
            style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#ec4899',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '8px',
            }}
          >
            HOW IT WORKS
          </div>
          <h2
            style={{
              fontSize: '32px',
              fontWeight: '700',
              color: '#1f2937',
              lineHeight: '1.2',
              margin: 0,
              maxWidth: '600px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Be on top of your game with the intelligent document processing
          </h2>
        </div>

        {/* Step 1 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '48px',
            alignItems: 'center',
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0 24px',
            marginBottom: '48px',
          }}
        >
          <div>
            <h3
              style={{
                fontSize: '24px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span
                style={{
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 'bold',
                }}
              >
                01
              </span>
              Upload your invoice PDFs
            </h3>
            <p style={{ fontSize: '16px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
              Drag and drop your PDF invoices or click to browse. Support for multiple files at
              once. Our system accepts standard PDF format and processes them instantly.
            </p>
          </div>
          <div
            style={{
              backgroundColor: '#fff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
              border: '1px solid #e5e7eb',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '12px', filter: 'grayscale(0.3)' }}>📄➡️🤖</div>
            <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: '500' }}>
              PDF Upload & AI Processing
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '48px',
            alignItems: 'center',
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0 24px',
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
              border: '1px solid #e5e7eb',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '12px', filter: 'grayscale(0.3)' }}>🔍✅📊</div>
            <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: '500' }}>
              Field Extraction & Validation
            </div>
          </div>
          <div>
            <h3
              style={{
                fontSize: '24px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span
                style={{
                  backgroundColor: '#ec4899',
                  color: 'white',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 'bold',
                }}
              >
                02
              </span>
              Auto-extract data with AI
            </h3>
            <p style={{ fontSize: '16px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
              Our advanced AI engine automatically extracts all invoice fields including supplier
              details, buyer information, amounts, taxes, and validates against 34 mandatory
              e-invoice requirements.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '48px',
            alignItems: 'center',
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '0 24px',
          }}
        >
          <div>
            <h3
              style={{
                fontSize: '24px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span
                style={{
                  backgroundColor: '#10b981',
                  color: 'white',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 'bold',
                }}
              >
                03
              </span>
              Generate & share reports
            </h3>
            <p style={{ fontSize: '16px', color: '#6b7280', lineHeight: '1.6', margin: 0 }}>
              Get instant compliance reports with detailed analysis. Download professional PDF
              reports, save validation history, and share results via email with stakeholders.
            </p>
          </div>
          <div
            style={{
              backgroundColor: '#fff',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
              border: '1px solid #e5e7eb',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '12px', filter: 'grayscale(0.3)' }}>📊📧💾</div>
            <div style={{ fontSize: '14px', color: '#6b7280', fontWeight: '500' }}>Reports & Sharing</div>
          </div>
        </div>
      </div>

      {/* Email Form Modal */}
      {emailForm.show && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
            }}
          >
            <h4 style={{ margin: '0 0 20px 0', color: '#24292f' }}>Send Validation Report</h4>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#24292f' }}>
                Recipient Email:
              </label>
              <input
                type="email"
                value={emailForm.email}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="Enter recipient email address"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#24292f' }}>
                Subject:
              </label>
              <input
                type="text"
                value={emailForm.subject}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, subject: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#24292f' }}>
                Message:
              </label>
              <textarea
                value={emailForm.message}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, message: e.target.value }))}
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={closeEmailForm}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4b5563')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#6b7280')}
              >
                Cancel
              </button>
              <button
                onClick={sendEmail}
                disabled={!emailForm.email.trim()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: emailForm.email.trim() ? '#8b5cf6' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: emailForm.email.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  fontWeight: '500',
                }}
                onMouseEnter={(e) => {
                  if (emailForm.email.trim()) e.currentTarget.style.backgroundColor = '#7c3aed';
                }}
                onMouseLeave={(e) => {
                  if (emailForm.email.trim()) e.currentTarget.style.backgroundColor = '#8b5cf6';
                }}
              >
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UploadPdf;
