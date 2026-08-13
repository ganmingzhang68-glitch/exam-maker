import React, { useEffect, useState } from 'react';
import { Alert, Card, Progress, Spin, Table, Tabs, Tag, Typography, message } from 'antd';
import type { MasteryLevel, StudentKnowledgeMastery, StudentLearningOverview } from '@exam-maker/shared';
import { getMyLearning } from '../services/learning';

const { Title, Text } = Typography;
const levelLabels: Record<MasteryLevel, string> = { mastered: '已掌握', good: '良好', developing: '发展中', weak: '建议重点复习', insufficient_data: '数据不足' };
const levelColors: Record<MasteryLevel, string> = { mastered: 'green', good: 'blue', developing: 'orange', weak: 'red', insufficient_data: 'default' };

const StudentLearning: React.FC = () => {
  const [data, setData] = useState<StudentLearningOverview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getMyLearning().then(setData).catch((error) => message.error(
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载知识点表现失败',
  )).finally(() => setLoading(false)); }, []);
  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!data) return null;
  const columns = [
    { title: '知识点', dataIndex: 'knowledgePointName', render: (value: string, row: StudentKnowledgeMastery) => <Text style={{ paddingLeft: row.parentKnowledgePointId ? 24 : 0 }}>{row.parentKnowledgePointId ? '└ ' : ''}{value}</Text> },
    { title: '掌握程度', dataIndex: 'masteryLevel', render: (value: MasteryLevel) => <Tag color={levelColors[value]}>{levelLabels[value]}</Tag> },
    { title: '历史得分率', dataIndex: 'scoreRate', render: (value: number | null) => value === null ? '—' : <Progress percent={Math.round(value * 100)} size="small" /> },
    { title: `近期 ${data.configuration.recentDays} 天`, dataIndex: 'recentScoreRate', render: (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%` },
    { title: '作答题数', dataIndex: 'questionCount' }, { title: '考试数', dataIndex: 'assessmentCount' },
    { title: '最近表现', dataIndex: 'lastAssessedAt', render: (value: string | null) => value ? new Date(value).toLocaleDateString() : '暂无' },
  ];
  return <div><Title level={3}>知识点表现</Title>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="这是基于已批改考试的透明统计结果" description={`近期表现权重更高（半衰期 ${data.configuration.halfLifeDays} 天）；少于 ${data.configuration.minimumQuestions} 道题时标记为数据不足。当前系统没有逐题作答时间，因此不展示虚构耗时。`} />
    {data.courses.length === 0 ? <Card><Text type="secondary">尚未加入课程或没有可分析的知识点。</Text></Card> : <Tabs items={data.courses.map(course => ({ key: String(course.courseId), label: course.courseName,
      children: <Table<StudentKnowledgeMastery> rowKey="knowledgePointId" columns={columns} dataSource={course.knowledgePoints} pagination={false} locale={{ emptyText: '课程尚未建立考点体系' }} /> }))} />}
  </div>;
};
export default StudentLearning;
