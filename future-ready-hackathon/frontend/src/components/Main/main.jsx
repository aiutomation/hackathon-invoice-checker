import React from "react";
import './main.css'
import invoiceImg from '../../assets/invoice.png';

export const Main = () => {
    return (
        <section className="hero">
            <div className="hero-content">
                <p className="eyebrow">Invoice Validator</p>
                <h1 className="headline">
                    Capture & extract
                    <br />
                    data from <span className="highlight">invoices</span>
                </h1>
                <p className="subtext">
                    Parse and validate unstructured invoices, by cross-checking 34 mandatory LHDN invoice fields
                </p>
                <div className="cta-group">
                    <button className="cta-btn">Get started - it's free</button>
                </div>
            </div>

            <div className="hero-visual">
                <div className="mock-browser">
                    <img src={invoiceImg} alt="Example receipt" />
                </div>
                <div className="code-card">
                    <pre>
                        {`{
  "receipt-data": {
    "date-time": "11 Jan 2023, 2:45:27",
    "order": "Burrito wrap",
    "price": "$8.00",
    "subtotal": "$8.00",
    "tax": "$0.70",
    "total": "$8.70",
    "order-ID": "10DHJKESDTYU"
  }
}`}
                    </pre>
                </div>
            </div>
        </section>
    );
}