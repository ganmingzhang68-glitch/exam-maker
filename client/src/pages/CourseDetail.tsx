import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Space, Spin, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, BookOutlined, CalendarOutlined, DatabaseOutlined, FileDoneOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import type { CourseDetail as CourseDetailType, CourseDifficultyCalibration, DifficultyCalibrationRecord } from '@exam-maker/shared';
import { getCourse, getCourseDifficultyCalibration } from '../services/course';

const { Title, Text } = Typography;
const statusLabel = { draft: '草稿', active: '进行中', archived: '已归档' } as const;

const CourseDetail: React.FC = () => {
  const { id } = useParams();
  const courseId = Number(id);
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [calibration, setCalibration] = useState<CourseDifficultyCalibration | null>(null);
  const [calibrationLoading, setCalibrationLoading] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(courseId) || courseId <= 0) { navigate('/courses', { replace: true }); return; }
    getCourse(courseId).then(setCourse).catch((error) => {
      message.error((error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载课程失败');
      navigate('/courses', { replace: true });
    }).finally(() => setLoading(false));
  }, [courseId, navigate]);

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!course) return null;
  const summary = course.summary;
  const loadCalibration = async () => {
    if (calibration || calibrationLoading) return;
    setCalibrationLoading(true);
    try { setCalibration(await getCourseDifficultyCalibration(courseId)); }
    catch (error) { message.error((error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '加载难度校准失败'); }
    finally { setCalibrationLoading(false); }
  };
  const percent = (value: number | null) => value === null ? '—' : value.toFixed(2);
  const calibrationView = <Spin spinning={calibrationLoading}><Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {calibration && <>
      {calibration.status === 'insufficient_sample' && <Alert type="info" showIcon message="当前课程数据不足，暂不进行自动校准" description={`已有 ${calibration.sampleSize} 条有效预测对照，至少需要 ${calibration.minimumSampleSize} 条。题目级历史仍会保留。`} />}
      <Row gutter={16}>
        <Col span={6}><Statistic title="有效对照" value={calibration.sampleSize} /></Col>
        <Col span={6}><Statistic title="MAE" value={percent(calibration.mae)} /></Col>
        <Col span={6}><Statistic title="RMSE" value={percent(calibration.rmse)} /></Col>
        <Col span={6}><Statistic title="偏差 (预测-实际)" value={percent(calibration.bias)} /></Col>
      </Row>
      <Table<DifficultyCalibrationRecord> rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={calibration.records} columns={[
        { title: '题目', dataIndex: 'questionStem', ellipsis: true },
        { title: 'AI预测', dataIndex: 'predictedDifficulty', render: percent },
        { title: '教师调整', dataIndex: 'teacherDifficulty', render: percent },
        { title: '实际难度', dataIndex: 'empiricalDifficulty', render: percent },
        { title: '样本', dataIndex: 'sampleSize' },
        { title: '结论', dataIndex: 'calibrationLabel', render: (value: DifficultyCalibrationRecord['calibrationLabel']) => ({ ai_underestimated: 'AI低估难度', ai_overestimated: 'AI高估难度', aligned: '基本准确', unavailable: '缺少AI预测' }[value]) },
      ]} />
    </>}
  </Space></Spin>;
  const placeholder = (title: string, action?: React.ReactNode) => <Empty description={`${title}将在对应模块中按课程关联展示`}>{action}</Empty>;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/courses')}>返回课程</Button></Space>
      <Card style={{ marginBottom: 16 }}>
        <Space align="start" size="large">
          <BookOutlined style={{ fontSize: 42, color: '#1677ff' }} />
          <div><Space><Title level={3} style={{ margin: 0 }}>{course.name}</Title><Tag color={course.status === 'active' ? 'green' : course.status === 'archived' ? 'orange' : 'default'}>{statusLabel[course.status]}</Tag></Space><Text type="secondary">{course.code || '未设置课程代码'} · {course.semester || '未设置学期'}</Text></div>
        </Space>
      </Card>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="班级" value={summary.classCount} prefix={<TeamOutlined />} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="资料" value={summary.materialCount} prefix={<DatabaseOutlined />} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="题目" value={summary.questionCount} prefix={<SolutionOutlined />} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="试卷" value={summary.paperCount} prefix={<FileDoneOutlined />} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="考试" value={summary.examCount} prefix={<CalendarOutlined />} /></Card></Col>
        <Col xs={12} md={8} xl={4}><Card><Statistic title="已批改作答" value={summary.gradedAttemptCount} /></Card></Col>
      </Row>
      <Card>
        <Tabs onChange={(key) => { if (key === 'difficulty') void loadCalibration(); }} items={[
          { key: 'overview', label: '课程概览', children: <Descriptions column={1} bordered items={[{ key: 'teacher', label: '授课教师', children: course.instructorName || '未设置' }, { key: 'semester', label: '学期', children: course.semester || '未设置' }, { key: 'description', label: '课程说明', children: course.description || '暂无说明' }]} /> },
          { key: 'classes', label: '班级', children: placeholder('班级', <Button onClick={() => navigate(`/classes?courseId=${course.id}`)}>查看课程班级</Button>) },
          { key: 'materials', label: '资料', children: placeholder('课程资料', <Button onClick={() => navigate('/projects/new')}>导入真题资料</Button>) },
          { key: 'questions', label: '题库', children: placeholder('课程题库', <Button onClick={() => navigate('/questions')}>进入题库</Button>) },
          { key: 'papers', label: '试卷', children: placeholder('课程试卷', <Button onClick={() => navigate('/papers')}>进入试卷库</Button>) },
          { key: 'exams', label: '考试', children: placeholder('课程考试', <Button onClick={() => navigate('/exams')}>进入考试管理</Button>) },
          { key: 'grades', label: '成绩', children: placeholder('课程成绩') },
          { key: 'ai', label: 'AI 命题', children: placeholder('AI 命题', <Button type="primary" onClick={() => navigate('/projects/new')}>创建出卷项目</Button>) },
          { key: 'difficulty', label: 'AI 难度校准', children: calibrationView },
          { key: 'settings', label: '设置', children: placeholder('课程设置') },
        ]} />
      </Card>
    </div>
  );
};

export default CourseDetail;
