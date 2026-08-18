import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, FormOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AssessmentItemMetric, Attempt, ExamAssessment, TeacherExamStudentResult } from '@exam-maker/shared';
import { getExamAssessment, listExamResults, listTeacherExams, reviewExamQuestionQuality } from '../services/exam';

const { Title, Text } = Typography;

interface ResultRow {
  key: string;
  student: TeacherExamStudentResult['student'];
  attempt: Attempt | null;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const ExamResults: React.FC = () => {
  const { id } = useParams();
  const examId = Number(id);
  const navigate = useNavigate();
  const [title, setTitle] = useState('考试成绩');
  const [students, setStudents] = useState<TeacherExamStudentResult[]>([]);
  const [assessment, setAssessment] = useState<ExamAssessment | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rows, exams, quality] = await Promise.all([listExamResults(examId), listTeacherExams(), getExamAssessment(examId)]);
      setStudents(rows);
      setAssessment(quality);
      setTitle(exams.find((exam) => exam.id === examId)?.title ?? '考试成绩');
    } catch (error) {
      message.error(errorMessage(error, '加载成绩失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [examId]);

  const rows = useMemo<ResultRow[]>(() => students.reduce<ResultRow[]>((all, item) => {
    if (item.attempts.length) {
      all.push(...item.attempts.map((attempt) => ({
        key: `${item.student.id}-${attempt.id}`,
        student: item.student,
        attempt,
      })));
    } else {
      all.push({ key: `${item.student.id}-none`, student: item.student, attempt: null });
    }
    return all;
  }, []), [students]);

  const columns: TableColumnsType<ResultRow> = [
    { title: '学生', key: 'student', render: (_, row) => <div><Text strong>{row.student.username}</Text><br /><Text type="secondary">{row.student.email}</Text></div> },
    { title: '作答次数', key: 'attemptNo', width: 100, render: (_, row) => row.attempt ? `第 ${row.attempt.attemptNo} 次` : '-' },
    {
      title: '状态', key: 'status', width: 110,
      render: (_, row) => row.attempt
        ? <Tag color={row.attempt.status === 'graded' ? 'success' : row.attempt.status === 'grading' ? 'warning' : 'default'}>{row.attempt.status === 'graded' ? '已完成批改' : row.attempt.status === 'grading' ? '待人工批改' : row.attempt.status}</Tag>
        : <Tag>未作答</Tag>,
    },
    { title: '客观题', key: 'objective', width: 100, render: (_, row) => row.attempt ? `${row.attempt.objectiveScore} 分` : '-' },
    { title: '主观题', key: 'subjective', width: 100, render: (_, row) => row.attempt ? `${row.attempt.subjectiveScore} 分` : '-' },
    { title: '总分', key: 'total', width: 100, render: (_, row) => row.attempt ? <Text strong>{row.attempt.totalScore} 分</Text> : '-' },
    { title: '提交时间', key: 'submittedAt', width: 180, render: (_, row) => row.attempt?.submittedAt ? new Date(row.attempt.submittedAt).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_, row) => row.attempt && ['grading', 'graded', 'submitted'].includes(row.attempt.status)
        ? <Button icon={<FormOutlined />} onClick={() => navigate(`/exams/${examId}/attempts/${row.attempt!.id}/grade`)}>查看/批改</Button>
        : null,
    },
  ];

  const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  const metric = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits);
  const reviewQuality = async (item: AssessmentItemMetric, action: 'confirm' | 'ignore' | 'needs_revision') => {
    try {
      await reviewExamQuestionQuality(examId, item.paperQuestionId, action);
      setAssessment(await getExamAssessment(examId));
      message.success(action === 'needs_revision' ? '已加入题库待修订' : '处理状态已保存');
    } catch (error) { message.error(errorMessage(error, '保存题目质量处理状态失败')); }
  };
  const needsAttention = assessment?.items.filter(item => item.flags.some(flag => flag !== 'INSUFFICIENT_SAMPLE')) ?? [];
  const qualityColumns: TableColumnsType<AssessmentItemMetric> = [
    { title: '题目', dataIndex: 'orderNo', width: 70, render: (value: number) => `Q${value}` },
    { title: '题干', dataIndex: 'stem', ellipsis: true },
    { title: '样本', dataIndex: 'sampleSize', width: 70 },
    { title: '正确率', dataIndex: 'correctRate', width: 100, render: percent },
    { title: '经验难度', dataIndex: 'empiricalDifficulty', width: 100, render: percent },
    { title: '区分度', dataIndex: 'discriminationIndex', width: 90, render: (value: number | null) => metric(value) },
    { title: '点二列', dataIndex: 'pointBiserialCorrelation', width: 90, render: (value: number | null) => metric(value) },
    { title: '提示', dataIndex: 'flags', width: 180, render: (flags: string[], row) => row.status === 'insufficient_sample'
      ? <Tag>样本不足，仅供参考</Tag>
      : flags.length ? flags.map(flag => <Tag key={flag} color="warning">{flag}</Tag>) : <Tag color="success">暂无统计异常</Tag> },
    { title: '处理', width: 210, render: (_: unknown, row) => <Space size={4}>
      <Button size="small" type={row.reviewStatus === 'confirmed' ? 'primary' : 'default'} onClick={() => void reviewQuality(row, 'confirm')}>确认</Button>
      <Button size="small" type={row.reviewStatus === 'ignored' ? 'primary' : 'default'} onClick={() => void reviewQuality(row, 'ignore')}>忽略</Button>
      <Button size="small" danger={row.reviewStatus !== 'needs_revision'} type={row.reviewStatus === 'needs_revision' ? 'primary' : 'default'} onClick={() => void reviewQuality(row, 'needs_revision')}>待修订</Button>
    </Space> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/exams')}>返回考试管理</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>
      <Title level={4} style={{ marginBottom: 4 }}>{title}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>查看学生提交状态、自动判分结果和人工批改进度。</Text>
      <Title level={4}>考试质量</Title>
      {assessment?.sampleStatus === 'insufficient_sample' && <Alert type="warning" showIcon
        message="样本不足，仅供参考" description={`当前只有 ${assessment.sampleSize} 个有效学生样本，至少需要 ${assessment.configuration.minimumSampleSize} 个才报告区分度、点二列相关和信度。`} style={{ marginBottom: 16 }} />}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card><Statistic title="参与人数" value={assessment?.summary.participantCount ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="平均分" value={assessment?.summary.meanScore ?? '—'} suffix={assessment ? `/ ${assessment.summary.totalScore}` : undefined} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="标准差" value={assessment?.summary.standardDeviation ?? '—'} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="中位数" value={assessment?.summary.medianScore ?? '—'} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="及格率" value={percent(assessment?.summary.passingRate ?? null)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="Cronbach α" value={metric(assessment?.summary.cronbachAlpha ?? null, 3)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="平均经验难度" value={percent(assessment?.summary.averageEmpiricalDifficulty ?? null)} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="平均区分度" value={metric(assessment?.summary.averageDiscrimination ?? null)} /></Card></Col>
      </Row>
      <Card title="需要教师关注" style={{ marginBottom: 16 }}>
        {assessment?.sampleStatus === 'insufficient_sample'
          ? <Text type="secondary">样本达到最低要求后才生成确定性的关注提示。</Text>
          : needsAttention.length === 0 ? <Text type="secondary">当前没有题目触发统计阈值；仍建议结合教学目标人工复核。</Text>
            : <Space direction="vertical">{needsAttention.map(item => <Alert key={item.paperQuestionId} type="warning" showIcon
              message={`Q${item.orderNo}：建议教师复核`} description={`正确率 ${percent(item.correctRate)}，区分度 ${metric(item.discriminationIndex)}；标记：${item.flags.join('、')}`} />)}</Space>}
      </Card>
      <Table<AssessmentItemMetric> rowKey="paperQuestionId" size="small" loading={loading} columns={qualityColumns}
        dataSource={assessment?.items ?? []} pagination={false} scroll={{ x: 1150 }} style={{ marginBottom: 24 }}
        expandable={{ rowExpandable: row => row.optionStatistics.length > 0, expandedRowRender: row => <Table
          rowKey="optionId" size="small" pagination={false} dataSource={row.optionStatistics} columns={[
            { title: '选项', dataIndex: 'optionId', width: 70 }, { title: '内容', dataIndex: 'text' },
            { title: '全体选择率', dataIndex: 'selectionRate', render: percent },
            { title: '高分组', dataIndex: 'highGroupSelectionRate', render: percent },
            { title: '低分组', dataIndex: 'lowGroupSelectionRate', render: percent },
            { title: '规则状态', dataIndex: 'status', render: (value: string, option) => <Tag color={value === 'effective' ? 'success' : 'warning'}>{option.isCorrect ? '正确选项' : value}</Tag> },
          ]} /> }} />
      <Title level={4}>学生成绩</Title>
      <Table<ResultRow>
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条作答记录` }}
      />
    </div>
  );
};

export default ExamResults;
