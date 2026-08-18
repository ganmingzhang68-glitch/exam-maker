import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Row, Space, Spin, Statistic, Table, Tag, Timeline, Typography, message } from 'antd';
import { AuditOutlined, BookOutlined, CalendarOutlined, FileAddOutlined, FileDoneOutlined, RobotOutlined, TeamOutlined } from '@ant-design/icons';
import type { TeacherDashboardData, TeacherDashboardExam } from '@exam-maker/shared';
import { getTeacherDashboard } from '../services/dashboard';

const { Title, Text } = Typography;
const examStatus = { draft: { label: '草稿', color: 'default' }, published: { label: '已发布', color: 'processing' }, closed: { label: '已关闭', color: 'default' } } as const;

const TeacherDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getTeacherDashboard().then(setData).catch(() => message.error('加载教师首页失败')).finally(() => setLoading(false)); }, []);
  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!data) return <Empty description="Dashboard 暂时不可用" />;
  const metricCards = [
    { title: '进行中课程', value: data.metrics.activeCourseCount, icon: <BookOutlined />, color: '#1677ff' },
    { title: '进行中班级', value: data.metrics.activeClassCount, icon: <TeamOutlined />, color: '#13c2c2' },
    { title: '已发布考试', value: data.metrics.ongoingExamCount, icon: <CalendarOutlined />, color: '#722ed1' },
    { title: '待批改人数', value: data.metrics.pendingGradingCount, icon: <AuditOutlined />, color: '#fa8c16' },
    { title: '近 7 日提交', value: data.metrics.weeklySubmissionCount, icon: <FileDoneOutlined />, color: '#52c41a' },
  ];
  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 20 }}><div><Title level={3} style={{ margin: 0 }}>教师工作台</Title><Text type="secondary">课程、考试、批改和 AI 命题的集中入口。</Text></div><Space><Button icon={<FileAddOutlined />} onClick={() => navigate('/papers')}>人工组卷</Button><Button type="primary" icon={<RobotOutlined />} onClick={() => navigate('/projects/new')}>AI 出题</Button></Space></div>
    <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>{metricCards.map((item) => <Col xs={12} md={8} xl={4} key={item.title}><Card><Statistic title={item.title} value={item.value} prefix={React.cloneElement(item.icon, { style: { color: item.color } })} /></Card></Col>)}</Row>
    {data.issues.length > 0 && <Alert type="warning" showIcon message={`有 ${data.issues.length} 项需要处理`} description={<Space direction="vertical">{data.issues.map((issue) => <Button key={`${issue.type}-${issue.resourceId}`} type="link" style={{ padding: 0 }} onClick={() => navigate(`/projects/${issue.resourceId}`)}>{issue.title}：{issue.description}</Button>)}</Space>} style={{ marginBottom: 20 }} />}
    <Card title="近期考试" extra={<Button type="link" onClick={() => navigate('/exams')}>查看全部</Button>} style={{ marginBottom: 20 }}>
      <Table<TeacherDashboardExam> rowKey="id" pagination={false} dataSource={data.recentExams} locale={{ emptyText: '暂无考试' }} columns={[
        { title: '考试', dataIndex: 'title' }, { title: '课程', dataIndex: 'course' },
        { title: '班级', dataIndex: 'classNames', render: (names: string[]) => names.length ? names.join('、') : '全部学生（兼容发布）' },
        { title: '时间', key: 'time', render: (_, item) => `${item.startAt ? new Date(item.startAt).toLocaleString('zh-CN') : '-'} ～ ${item.endAt ? new Date(item.endAt).toLocaleString('zh-CN') : '-'}` },
        { title: '提交', key: 'submit', render: (_, item) => `${item.submittedCount}/${item.assignmentCount}` },
        { title: '待批改', dataIndex: 'pendingGradingCount', render: (value) => value > 0 ? <Tag color="warning">{value} 人</Tag> : '0' },
        { title: '状态', dataIndex: 'status', render: (value: keyof typeof examStatus) => <Tag color={examStatus[value].color}>{examStatus[value].label}</Tag> },
        { title: '操作', key: 'action', render: (_, item) => <Space><Button size="small" onClick={() => navigate(`/exams/${item.id}/results`)}>成绩/批改</Button></Space> },
      ]} />
    </Card>
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}><Card title="最近生成和编辑的试卷" extra={<Button type="link" onClick={() => navigate('/papers')}>试卷库</Button>}>{data.recentPapers.length ? <Table rowKey="id" size="small" pagination={false} dataSource={data.recentPapers} columns={[{ title: '试卷', dataIndex: 'title' }, { title: '课程', dataIndex: 'course' }, { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> }, { title: '更新时间', dataIndex: 'updatedAt', render: (value) => new Date(value).toLocaleString('zh-CN') }]} onRow={(item) => ({ onClick: () => navigate(`/papers/${item.id}`), style: { cursor: 'pointer' } })} /> : <Empty description="暂无试卷" />}</Card></Col>
      <Col xs={24} xl={10}><Card title="最近活动">{data.activities.length ? <Timeline items={data.activities.map((item) => ({ children: <div><div>{item.title}</div><Text type="secondary">{new Date(item.occurredAt).toLocaleString('zh-CN')}</Text></div> }))} /> : <Empty description="暂无活动" />}</Card></Col>
    </Row>
  </div>;
};

export default TeacherDashboard;
