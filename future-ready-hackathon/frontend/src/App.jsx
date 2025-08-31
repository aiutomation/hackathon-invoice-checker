import React from 'react';
import './App.css';
import Navbar from './components/Navbar/navbar';
import { Main } from './components/Main/main';
import 'bootstrap/dist/css/bootstrap.min.css';
import UploadPdf from './components/Upload/UploadPdf';

const App = () => {
  return (
     <div className='Navbar'>
      <Navbar/>
      <Main/>
      <UploadPdf/>
     </div>
  );
};

export default App;