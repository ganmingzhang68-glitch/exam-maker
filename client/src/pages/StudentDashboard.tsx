import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, List, Row, Space, Spin, Statistic, Tag, Typography, message } from 'antd';
import { BookOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, FormOutlined } from '@ant-design/icons';
import type { StudentDashboardData, StudentExamDisplayStatus, StudentExamSummary } from '@exam-maker/shared';
import { getStudentDashboard } from '../services/dashboard';
import { startExam } from '../services/exam';

const { Title, Text } = Typography;
const statusMeta: Record<StudentExamDisplayStatus, { label: string; color: string }> = {
  upcoming: { label: '未开始', color: 'default' }, available: { label: '可参加', color: 'processing' },
  in_progress: { label: '进行中', color: 'warning' }, submitted: { label: '已提交', color: 'cyan' },
  grading: { label: '待批改', color: 'orange' }, graded: { label: '已评分', color: 'success' }, ended: { label: '已结束', color: 'default' },
};

const StudentDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<number | null>(null);
  const load = async () => { setLoading(true); try { setData(await getStudentDashboard()); } catch { message.error('加载学生首页失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const begin = async (exam: StudentExamSummary) => { setStarting(exam.id); try { const detail = await startExam(exam.id); navigate(`/attempts/${detail.attempt.id}`); } catch (error) { message.error((error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '开始考试失败'); await load(); } finally { setStarting(null); } };
  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!data) return <Empty description="Dashboard 暂时不可用" />;
  const current = data.exams.filter((exam) => ['available', 'in_progress', 'upcoming'].includes(exam.displayStatus));
  const examAction = (exam: StudentExamSummary) => {
    if (exam.displayStatus === 'in_progress' && exam.latestAttempt) return <Button type="primary" icon={<FormOutlined />} onClick={() => navigate(`/attempts/${exam.latestAttempt!.id}`)}>继续作答</Button>;
    if (exam.displayStatus === 'available') return <Button type="primary" loading={starting === exam.id} onClick={() => begin(exam)}>开始考试</Button>;
    if (['submitted', 'grading', 'graded'].includes(exam.displayStatus) && exam.latestAttempt) return <Button onClick={() => navigate(`/attempts/${exam.latestAttempt!.id}/result`)}>查看成绩</Button>;
    return <Button disabled>{statusMeta[exam.displayStatus].label}</Button>;
  };
  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><div><Title level={3} style={{ margin: 0 }}>学习与考试</Title><Text type="secondary">考试状态由服务器统一计算，刷新页面也能恢复作答。</Text></div><Button onClick={() => navigate('/student/exams')}>全部考试</Button></div>
    <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
      <Col xs={12} md={6}><Card><Statistic title="待完成" value={data.metrics.pendingCount} prefix={<CalendarOutlined />} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="进行中" value={data.metrics.inProgressCount} prefix={<ClockCircleOutlined />} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="即将开始" value={data.metrics.upcomingCount} prefix={<CalendarOutlined />} /></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title="已完成" value={data.metrics.completedCount} prefix={<CheckCircleOutlined />} /></Card></Col>
    </Row>
    <Card title="待办考试" style={{ marginBottom: 20 }}>{current.length ? <List dataSource={current} renderItem={(exam) => <List.Item actions={[examAction(exam)]}><List.Item.Meta title={<Space>{exam.title}<Tag color={statusMeta[exam.displayStatus].color}>{statusMeta[exam.displayStatus].label}</Tag></Space>} description={`${exam.paperTitle} · ${exam.totalScore} 分 · ${exam.startAt ? new Date(exam.startAt).toLocaleString('zh-CN') : '-'} ～ ${exam.endAt ? new Date(exam.endAt).toLocaleString('zh-CN') : '-'}`} /></List.Item>} /> : <Empty description="暂无待办考试" />}</Card>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}><Card title="所属课程">{data.courses.length ? <List dataSource={data.courses} renderItem={(course) => <List.Item><List.Item.Meta avatar={<BookOutlined style={{ fontSize: 24, color: '#1677ff' }} />} title={course.name} description={`${course.className} · ${course.semester || '未设置学期'}`} /></List.Item>} /> : <Empty description="暂未加入课程班级" />}</Card></Col>
      <Col xs={24} lg={12}><Card title="最近成绩">{data.recentScores.length ? <List dataSource={data.recentScores} renderItem={(score) => <List.Item actions={[<Button key="detail" type="link" onClick={() => navigate(`/attempts/${score.attemptId}/result`)}>详情</Button>]}><List.Item.Meta title={score.examTitle} description={score.gradedAt ? new Date(score.gradedAt).toLocaleString('zh-CN') : ''} /><Text strong>{score.score} / {score.totalScore}</Text></List.Item>} /> : <Empty description="暂无已发布成绩" />}</Card></Col>
    </Row>
  </div>;
};

export default StudentDashboard;
