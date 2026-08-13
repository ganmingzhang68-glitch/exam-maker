import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Progress, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type { TeacherCourseKnowledgeAnalytics, TeacherKnowledgeAnalyticsItem } from '@exam-maker/shared';
import { getCourseKnowledgeAnalytics } from '../services/learning';

const { Title, Text } = Typography;
const TeacherKnowledgeAnalytics: React.FC = () => {
  const courseId = Number(useParams().id); const navigate = useNavigate();
  const [data, setData] = useState<TeacherCourseKnowledgeAnalytics | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { getCourseKnowledgeAnalytics(courseId).then(setData).catch((error) => {
    message.error((error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载班级知识点分析失败'); navigate(`/courses/${courseId}`);
  }).finally(() => setLoading(false)); }, [courseId, navigate]);
  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!data) return null;
  return <div><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/courses/${courseId}`)} style={{ marginBottom: 16 }}>返回课程</Button>
    <Title level={3}>{data.courseName} · 班级知识点分析</Title>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="用于安排复习重点，不给学生贴标签" description="仅汇总已批改考试。‘建议关注’表示近期得分率偏低，仍需教师结合教学情境判断。" />
    <Card style={{ marginBottom: 16 }}><Statistic title="在读学生" value={data.enrolledStudentCount} /></Card>
    <Table<TeacherKnowledgeAnalyticsItem> rowKey="knowledgePointId" pagination={false} dataSource={data.items} columns={[
      { title: '知识点', dataIndex: 'knowledgePointName', render: (value: string, row) => <Text style={{ paddingLeft: row.parentKnowledgePointId ? 24 : 0 }}>{row.parentKnowledgePointId ? '└ ' : ''}{value}</Text> },
      { title: '班级平均得分率', dataIndex: 'averageScoreRate', render: (value: number | null) => value === null ? '—' : <Progress percent={Math.round(value * 100)} size="small" status={value < 0.5 ? 'exception' : 'normal'} /> },
      { title: '有数据学生', dataIndex: 'studentCount' }, { title: '作答样本', dataIndex: 'questionCount' },
      { title: '建议关注人数', dataIndex: 'weakStudentCount', render: (value: number) => value > 0 ? <Tag color="orange">{value}</Tag> : 0 },
      { title: '状态', dataIndex: 'status', render: (value: string) => value === 'available' ? '可分析' : '数据不足' },
    ]} locale={{ emptyText: '课程尚未建立考点体系' }} />
  </div>;
};
export default TeacherKnowledgeAnalytics;
