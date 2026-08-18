import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './App.css';

const antdTheme = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
  },
};

// Static message/modal instances render outside the application tree. Give
// those holders the same locale and theme so they do not lose context.
ConfigProvider.config({
  holderRender: (children) => (
    <ConfigProvider locale={zhCN} theme={antdTheme}>{children}</ConfigProvider>
  ),
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={antdTheme}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
