import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, List, Progress, Row, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type { TeachingAnalytics as TeachingAnalyticsType, TeachingAttentionStudent } from '@exam-maker/shared';
import { getTeachingAnalytics, refreshTeachingAnalytics } from '../services/teachingAnalytics';
const { Title, Text } = Typography;
const reasonLabels = { missed_submission: '缺交', score_decline: '成绩下降', persistent_weakness: '持续薄弱' } as const;
function rate(value: number | null) { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载失败'; }
const TeachingAnalytics: React.FC = () => {
  const courseId = Number(useParams().id); const navigate = useNavigate(); const [data, setData] = useState<TeachingAnalyticsType | null>(null); const [loading, setLoading] = useState(true);
  const load = (refresh = false) => { setLoading(true); (refresh ? refreshTeachingAnalytics(courseId) : getTeachingAnalytics(courseId)).then(setData).catch(error => message.error(errorText(error))).finally(() => setLoading(false)); };
  useEffect(() => { if (!courseId) navigate('/courses'); else load(); }, [courseId]);
  if (loading && !data) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!data) return null; const summary = data.summary;
  return <div><Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/courses/${courseId}`)}>返回课程</Button><Button icon={<ReloadOutlined />} loading={loading} onClick={() => load(true)}>重新计算</Button></Space>
    <Title level={3}>{data.courseName} · 教学分析</Title>
    <Alert type="info" showIcon message="全部结论来自可解释规则" description={`数据截止 ${new Date(data.generatedAt).toLocaleString()}，版本 ${data.calculationVersion}。关注名单是教学提醒，不是自动处分或评价。`} />
    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
      <Col span={6}><Card><Statistic title="在读学生" value={summary.enrolledStudentCount} /></Card></Col><Col span={6}><Card><Statistic title="考试参与率" value={rate(summary.participationRate)} /></Card></Col>
      <Col span={6}><Card><Statistic title="正式考试平均得分率" value={rate(summary.averageScoreRate)} /></Card></Col><Col span={6}><Card><Statistic title="已完成练习" value={summary.completedPracticeCount} /></Card></Col>
      <Col span={6}><Card><Statistic title="练习平均得分率" value={rate(summary.averagePracticeScoreRate)} /></Card></Col><Col span={6}><Card><Statistic title="低质量题目记录" value={summary.lowQualityQuestionCount} /></Card></Col>
      <Col span={6}><Card><Statistic title="待审核题目" value={summary.pendingQuestionReviewCount} /></Card></Col><Col span={6}><Card><Statistic title="需关注学生" value={data.attentionStudents.length} /></Card></Col>
    </Row>
    <Card title="薄弱知识点" style={{ marginTop: 16 }}><Table rowKey="knowledgePointId" pagination={false} dataSource={summary.weakKnowledgePoints} columns={[{ title: '知识点', dataIndex: 'name' }, { title: '平均得分率', dataIndex: 'averageScoreRate', render: (value: number | null) => value === null ? '—' : <Progress percent={Math.round(value * 100)} size="small" /> }, { title: '薄弱学生数', dataIndex: 'weakStudentCount' }]} /></Card>
    <Card title="需关注学生（规则证据）" style={{ marginTop: 16 }}><Table<TeachingAttentionStudent> rowKey="studentId" pagination={false} dataSource={data.attentionStudents} columns={[{ title: '学生', dataIndex: 'username' }, { title: '原因', dataIndex: 'reasons', render: (values: TeachingAttentionStudent['reasons']) => <Space>{values.map(value => <Tag color="orange" key={value}>{reasonLabels[value]}</Tag>)}</Space> }, { title: '考试完成', render: (_, row) => `${row.evidence.completedExamCount}/${row.evidence.assignedExamCount}` }, { title: '上次→最近', render: (_, row) => `${rate(row.evidence.previousScoreRate)} → ${rate(row.evidence.latestScoreRate)}` }, { title: '薄弱知识点', render: (_, row) => row.evidence.weakKnowledgePointCount }]} /></Card>
    <Card title="判定规则" style={{ marginTop: 16 }}><List dataSource={data.rules} renderItem={item => <List.Item><Text code>{item}</Text></List.Item>} /></Card>
  </div>;
};
export default TeachingAnalytics;
