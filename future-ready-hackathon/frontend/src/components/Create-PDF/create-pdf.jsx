// create-pdf.jsx
// npm i jspdf jspdf-autotable
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Build a jsPDF document for the e-Invoice coverage report.
 * validation = {
 *   fileName, timestamp, totalExtracted, fieldsIdentified, completionRate,
 *   extractedFields: [{ name, value, isMandatory }, ...],
 *   missingFields: [ 'Supplier TIN', ... ]
 * }
 */
export function buildValidationPdfDoc(validation, opts = {}) {
  const {
    fileName = 'File',
    timestamp = new Date().toLocaleString(),
    fieldsIdentified = 0,
    completionRate = 0,
    extractedFields = [],
    missingFields = [],
  } = validation;

  const totalMandatory = Number.isFinite(opts.totalMandatory) ? opts.totalMandatory : 33;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentPage = 1;
  let y = 40;

  // Function to add consistent header and footer to each page
  const addHeaderFooter = (pageNumber = null) => {
    const currentPageNum = pageNumber || doc.internal.getNumberOfPages();
    
    // Save current font settings
    const currentFont = doc.internal.getFont();
    const currentFontSize = doc.internal.getFontSize();
    const currentTextColor = doc.internal.getTextColor();
    
    // Header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(fileName, 40, 20);
    
    // Footer with page number
    const pageStr = `Page ${currentPageNum}`;
    const pageStrWidth = doc.getTextWidth(pageStr);
    doc.text(pageStr, pageWidth - 40 - pageStrWidth, pageHeight - 20);
    
    // Restore previous font settings
    doc.setFont(currentFont.fontName, currentFont.fontStyle);
    doc.setFontSize(currentFontSize);
    doc.setTextColor(currentTextColor);
  };

  // Function to check if we need a new page and add header/footer
  const checkPageBreak = (requiredSpace = 60) => {
    if (y + requiredSpace > pageHeight - 60) {
      addHeaderFooter(currentPage);
      doc.addPage();
      currentPage++;
      y = 60; // Start content below header space
    }
  };

  // Main header (skip header/footer space on first page)
  y = 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('E-Invoice Validation Report', 40, y);
  y += 30;

  // File info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(`File: ${fileName}`, 40, y);
  doc.text(`Generated: ${timestamp}`, 40, y + 16);
  y += 40;

  // Check space for summary cards
  checkPageBreak(100);

  // Summary cards
  const cardY = y;
  const cardH = 70;
  const gap = 12;
  const colW = (pageWidth - 80 - gap) / 2;

  // Left card: Mandatory fields identified
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(246, 248, 250);
  doc.roundedRect(40, cardY, colW, cardH, 6, 6, 'FD');
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text('Mandatory fields identified', 55, cardY + 22);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(0, 0, 0);
  doc.text(`${fieldsIdentified}/${totalMandatory}`, 55, cardY + 50);

  // Right card: Completion rate (color-coded)
  const compColor =
    completionRate >= 70 ? [45, 164, 78] : completionRate >= 40 ? [251, 133, 0] : [218, 54, 51];

  doc.setFillColor(240, 249, 255);
  doc.roundedRect(40 + colW + gap, cardY, colW, cardH, 6, 6, 'FD');
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text('Completion rate', 55 + colW + gap, cardY + 22);
  
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...compColor);
  doc.setFontSize(28);
  doc.text(`${completionRate}%`, 55 + colW + gap, cardY + 50);
  
  y = cardY + cardH + 40;

  // Check space for extracted fields section
  checkPageBreak(80);

  // Section: Extracted Fields
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Extracted Fields', 40, y);
  y += 20;

  // Extracted fields table
  if (extractedFields.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['#', 'Field Name', 'Value', 'Type']],
      body: extractedFields.map((f, i) => [
        String(i + 1),
        f?.name ?? '',
        f?.value ?? '',
        f?.isMandatory ? 'MANDATORY' : 'ADDITIONAL',
      ]),
      styles: { 
        font: 'helvetica', 
        fontSize: 9, 
        cellPadding: 6, 
        valign: 'top',
        lineColor: [220, 220, 220],
        lineWidth: 0.5
      },
      headStyles: { 
        fillColor: [246, 248, 250], 
        textColor: [36, 41, 47],
        fontStyle: 'bold',
        fontSize: 10
      },
      columnStyles: {
        0: { cellWidth: 30, halign: 'center' },
        1: { cellWidth: 150 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 100, halign: 'center' },
      },
      margin: { left: 40, right: 40 },
      pageBreak: 'auto',
      bodyStyles: { overflow: 'linebreak' },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          if (data.cell.raw === 'MANDATORY') {
            data.cell.styles.textColor = [45, 164, 78];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [9, 105, 218];
            data.cell.styles.fontStyle = 'normal';
          }
        }
      },
      didDrawPage: (data) => {
        // Update current page counter
        currentPage = doc.internal.getNumberOfPages();
      },
    });

    y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 30 : y + 30;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('No fields were extracted from this document.', 40, y);
    y += 30;
  }

  // Check space for missing fields section
  checkPageBreak(80);

  // Section: Missing Mandatory Fields
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  const missingCount = Math.max(totalMandatory - fieldsIdentified, 0);
  doc.text(`Missing Mandatory Fields (${missingCount})`, 40, y);
  y += 20;

  if (missingFields?.length) {
    autoTable(doc, {
      startY: y,
      head: [['#', 'Field Name']],
      body: missingFields.map((m, i) => [String(i + 1), m]),
      styles: { 
        font: 'helvetica', 
        fontSize: 9, 
        cellPadding: 6, 
        valign: 'top',
        lineColor: [220, 220, 220],
        lineWidth: 0.5
      },
      headStyles: { 
        fillColor: [255, 245, 245], 
        textColor: [117, 65, 16],
        fontStyle: 'bold',
        fontSize: 10
      },
      columnStyles: { 
        0: { cellWidth: 30, halign: 'center' },
        1: { cellWidth: 'auto' }
      },
      margin: { left: 40, right: 40 },
      pageBreak: 'auto',
      didDrawPage: (data) => {
        currentPage = doc.internal.getNumberOfPages();
      },
    });
    y = doc.lastAutoTable.finalY + 30;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(45, 164, 78);
    doc.text('All mandatory fields are present!', 40, y);
    doc.setTextColor(0, 0, 0);
    y += 30;
  }

  // Check space for compliance status
  checkPageBreak(60);

  // Section: Compliance Status
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Compliance Status', 40, y);
  y += 20;

  const statusText =
    completionRate >= 70
      ? 'EXCELLENT - High compliance achieved'
      : completionRate >= 40
      ? 'GOOD - Moderate compliance, some improvements needed'
      : 'NEEDS IMPROVEMENT - Low compliance, significant gaps identified';

  const statusColor =
    completionRate >= 70 ? [45, 164, 78] : completionRate >= 40 ? [251, 133, 0] : [218, 54, 51];

  // Add status text without special characters
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...statusColor);
  doc.text(statusText, 40, y);

  // Add header/footer to all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addHeaderFooter(i);
  }

  return doc;
}

/** Return a Blob you can store or download later */
export function makeValidationPdfBlob(validation, opts) {
  const doc = buildValidationPdfDoc(validation, opts);
  return doc.output('blob');
}

/** Open a new tab with the PDF */
export function openValidationPdf(validation, filename, opts) {
  const blob = makeValidationPdfBlob(validation, opts);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  return { blob, url };
}

/** Trigger a browser download immediately */
export function downloadValidationPdf(validation, filename, opts) {
  const doc = buildValidationPdfDoc(validation, opts);
  const safeFilename =
    filename ||
    `validation-report-${(validation.fileName || 'file')
      .replace(/\s+/g, '-')
      .replace(/[^\w\-\.]/g, '_')}-${Date.now()}.pdf`;
  doc.save(safeFilename);
  return safeFilename;
}