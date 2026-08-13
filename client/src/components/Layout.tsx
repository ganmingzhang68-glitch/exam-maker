import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Avatar, Dropdown, theme } from 'antd';
import {
  ProjectOutlined,
  PlusOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DatabaseOutlined,
  AuditOutlined,
  FileDoneOutlined,
  CalendarOutlined,
  SolutionOutlined,
  RobotOutlined,
  ReadOutlined,
  TeamOutlined,
  DashboardOutlined,
  ClockCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

const { Header, Sider, Content } = AntLayout;

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { token: themeToken } = theme.useToken();

  const menuItems = user?.role === 'student'
    ? [
      { key: '/student/dashboard', icon: <DashboardOutlined />, label: '学习首页' },
      { key: '/student/exams', icon: <SolutionOutlined />, label: '我的考试' },
      { key: '/student/learning', icon: <ReadOutlined />, label: '知识点表现' },
      { key: '/student/practice', icon: <EditOutlined />, label: '自主练习' },
    ]
    : [
      { key: '/', icon: <DashboardOutlined />, label: '教师首页' },
      { key: '/courses', icon: <ReadOutlined />, label: '课程管理' },
      { key: '/classes', icon: <TeamOutlined />, label: '班级管理' },
      { key: '/projects', icon: <ProjectOutlined />, label: '出卷项目' },
      { key: '/projects/new', icon: <PlusOutlined />, label: '新建项目' },
      { key: '/questions/generate', icon: <RobotOutlined />, label: '快速仿题' },
      { key: '/questions/review', icon: <AuditOutlined />, label: 'AI 题目审核' },
      { key: '/questions', icon: <DatabaseOutlined />, label: '教师题库' },
      { key: '/papers', icon: <FileDoneOutlined />, label: '试卷管理' },
      { key: '/exams', icon: <CalendarOutlined />, label: '考试管理' },
      { key: '/teacher/tasks', icon: <ClockCircleOutlined />, label: '后台任务' },
    ];

  const selectedMenuKey = location.pathname.startsWith('/student/dashboard')
    ? '/student/dashboard'
    : location.pathname.startsWith('/student/learning')
    ? '/student/learning'
    : location.pathname.startsWith('/student/practice')
    ? '/student/practice'
    : location.pathname.startsWith('/student/exams') || location.pathname.startsWith('/attempts/')
    ? '/student/exams'
    : location.pathname.startsWith('/teacher/tasks')
    ? '/teacher/tasks'
    : location.pathname.startsWith('/courses')
    ? '/courses'
    : location.pathname.startsWith('/classes')
    ? '/classes'
    : location.pathname.startsWith('/questions/review')
    ? '/questions/review'
    : location.pathname.startsWith('/questions/generate')
    ? '/questions/generate'
    : location.pathname.startsWith('/questions/') || location.pathname === '/questions'
      ? '/questions'
      : location.pathname.startsWith('/papers')
        ? '/papers'
        : location.pathname.startsWith('/exams')
          ? '/exams'
        : location.pathname.startsWith('/projects/new')
          ? '/projects/new'
          : location.pathname.startsWith('/projects/') || location.pathname === '/projects'
            ? '/projects'
            : '/';

  const userMenuItems = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenu = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout();
      navigate('/login');
    }
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="light"
        style={{
          borderRight: `1px solid ${themeToken.colorBorderSecondary}`,
          boxShadow: 'none',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
          }}
        >
          <span style={{ fontSize: collapsed ? 18 : 20, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            {collapsed ? '📝' : '📝 Exam Maker'}
          </span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedMenuKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <AntLayout>
        <Header
          style={{
            padding: '0 24px',
            background: themeToken.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
            height: 64,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }}>
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.username || '用户'}</span>
            </div>
          </Dropdown>
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: themeToken.colorBgContainer,
            borderRadius: themeToken.borderRadius,
            minHeight: 280,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
};

export default AppLayout;
