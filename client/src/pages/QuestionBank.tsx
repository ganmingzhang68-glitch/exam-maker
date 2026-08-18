import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Input,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type {
  DifficultyLevel,
  QuestionListItem,
  QuestionSource,
  QuestionStatus,
  QuestionType,
  CourseDetail,
} from '@exam-maker/shared';
import {
  deleteQuestion,
  bulkQuestionAction,
  copyQuestion,
  listQuestionSources,
  listQuestions,
  reviewQuestion,
} from '../services/question';
import { listCourses } from '../services/course';
import {
  difficultyLabels,
  questionStatusColors,
  questionStatusLabels,
  questionTypeLabels,
} from '../utils/examLabels';

const { Title, Text, Paragraph } = Typography;

interface QuestionBankProps {
  reviewMode?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const QuestionBank: React.FC<QuestionBankProps> = ({ reviewMode = false }) => {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<QuestionListItem[]>([]);
  const [sources, setSources] = useState<QuestionSource[]>([]);
  const [courses, setCourses] = useState<CourseDetail[]>([]);
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{
    status?: QuestionStatus;
    type?: QuestionType;
    difficulty?: DifficultyLevel;
    sourceFileId?: number;
    courseId?: number;
    origin?: QuestionListItem['origin'];
    lifecycleStatus?: QuestionListItem['lifecycleStatus'];
    search?: string;
    knowledgePoint?: string;
    usage?: 'used' | 'unused';
    sort?: 'updated_desc' | 'updated_asc' | 'score_desc' | 'score_asc';
  }>({ status: reviewMode ? 'generated' : undefined });

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      setQuestions(await listQuestions({ ...filters, limit: 100 }));
    } catch (error) {
      message.error(errorMessage(error, '加载题目失败'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  useEffect(() => {
    listQuestionSources().then(setSources).catch(() => undefined);
    listCourses().then(setCourses).catch(() => undefined);
  }, []);

  const changeReviewStatus = async (
    question: QuestionListItem,
    status: Extract<QuestionStatus, 'reviewed' | 'rejected'>,
  ) => {
    try {
      await reviewQuestion(question.id, status);
      message.success(status === 'reviewed' ? '题目已通过审核' : '题目已拒绝');
      await loadQuestions();
    } catch (error) {
      message.error(errorMessage(error, '审核操作失败'));
    }
  };

  const handleDelete = async (question: QuestionListItem) => {
    try {
      await deleteQuestion(question.id);
      message.success('题目已删除');
      await loadQuestions();
    } catch (error) {
      message.error(errorMessage(error, '删除题目失败'));
    }
  };

  const columns: TableColumnsType<QuestionListItem> = [
    {
      title: '题目',
      dataIndex: 'stem',
      width: '38%',
      render: (stem: string, record) => (
        <div>
          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 4 }}>{stem}</Paragraph>
          <Space size={4} wrap>
            {record.aiGenerated && <Tag color="purple">AI 生成</Tag>}
            <Text type="secondary" style={{ fontSize: 12 }}>#{record.id}</Text>
          </Space>
        </div>
      ),
    },
    {
      title: '题型',
      dataIndex: 'type',
      width: 100,
      render: (type: QuestionType) => questionTypeLabels[type],
    },
    {
      title: '难度',
      dataIndex: 'difficulty',
      width: 90,
      render: (difficulty: DifficultyLevel | null) => difficulty ? difficultyLabels[difficulty] : '未设置',
    },
    {
      title: '来源',
      dataIndex: 'sourceFileName',
      width: 170,
      ellipsis: true,
      render: (filename: string | null, record) => {
        const similarJobId = record.metadata?.similarQuestionJobId;
        if (typeof similarJobId === 'number') return `快速仿题 #${similarJobId}`;
        return filename || record.sourceProjectTitle || '手工录入';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: QuestionStatus) => (
        <Tag color={questionStatusColors[status]}>{questionStatusLabels[status]}</Tag>
      ),
    },
    {
      title: '默认分值',
      dataIndex: 'defaultScore',
      width: 90,
      render: (score: number) => `${score} 分`,
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4} wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/questions/${record.id}/edit`)}>
            编辑
          </Button>
          <Button size="small" onClick={() => navigate(`/questions/${record.id}`)}>详情</Button>
          <Button size="small" onClick={async () => { await copyQuestion(record.id); message.success('题目已复制'); await loadQuestions(); }}>复制</Button>
          {record.status !== 'reviewed' && (
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => changeReviewStatus(record, 'reviewed')}
            >
              通过
            </Button>
          )}
          {record.status !== 'rejected' && (
            <Popconfirm title="确认拒绝这道题？" onConfirm={() => changeReviewStatus(record, 'rejected')}>
              <Button size="small" danger icon={<StopOutlined />}>拒绝</Button>
            </Popconfirm>
          )}
          <Popconfirm title="确认删除这道题？" onConfirm={() => handleDelete(record)}>
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{reviewMode ? 'AI 题目审核' : '教师题库'}</Title>
          <Text type="secondary">
            {reviewMode ? '检查、修改并审核 AI 生成题目，通过后即可加入试卷。' : '管理已生成和手工维护的题目。'}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadQuestions}>刷新</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search allowClear placeholder="搜索题干" style={{ width: 220 }} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))} />
          <Select allowClear placeholder="课程" style={{ width: 180 }} value={filters.courseId} options={courses.map((course) => ({ value: course.id, label: course.name }))} onChange={(courseId) => setFilters((current) => ({ ...current, courseId }))} />
          {!reviewMode && (
            <Select
              allowClear
              placeholder="审核状态"
              style={{ width: 130 }}
              value={filters.status}
              options={Object.entries(questionStatusLabels).map(([value, label]) => ({ value, label }))}
              onChange={(status) => setFilters((current) => ({ ...current, status }))}
            />
          )}
          <Select
            allowClear
            placeholder="题型"
            style={{ width: 130 }}
            value={filters.type}
            options={Object.entries(questionTypeLabels).map(([value, label]) => ({ value, label }))}
            onChange={(type) => setFilters((current) => ({ ...current, type }))}
          />
          <Input allowClear placeholder="考点" style={{ width: 140 }} value={filters.knowledgePoint} onChange={(event) => setFilters((current) => ({ ...current, knowledgePoint: event.target.value || undefined }))} />
          <Select allowClear placeholder="题目来源" style={{ width: 140 }} value={filters.origin} options={[{ value: 'past_exam', label: '往年真题' }, { value: 'ai_generated', label: 'AI 生成' }, { value: 'teacher_created', label: '教师创建' }, { value: 'imported', label: '导入' }]} onChange={(origin) => setFilters((current) => ({ ...current, origin }))} />
          <Select allowClear placeholder="使用状态" style={{ width: 120 }} value={filters.usage} options={[{ value: 'used', label: '已使用' }, { value: 'unused', label: '未使用' }]} onChange={(usage) => setFilters((current) => ({ ...current, usage }))} />
          <Select allowClear placeholder="质量状态" style={{ width: 130 }} value={filters.lifecycleStatus}
            options={[{ value: 'approved', label: '质量正常' }, { value: 'needs_review', label: '需要复核' }, { value: 'draft', label: '草稿' }, { value: 'archived', label: '已归档' }]}
            onChange={(lifecycleStatus) => setFilters((current) => ({ ...current, lifecycleStatus }))} />
          <Select placeholder="排序" style={{ width: 140 }} value={filters.sort ?? 'updated_desc'} options={[{ value: 'updated_desc', label: '最近更新' }, { value: 'updated_asc', label: '最早更新' }, { value: 'score_desc', label: '分值从高到低' }, { value: 'score_asc', label: '分值从低到高' }]} onChange={(sort) => setFilters((current) => ({ ...current, sort }))} />
          <Select
            allowClear
            placeholder="难度"
            style={{ width: 120 }}
            value={filters.difficulty}
            options={Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))}
            onChange={(difficulty) => setFilters((current) => ({ ...current, difficulty }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="来源文件"
            style={{ width: 260 }}
            value={filters.sourceFileId}
            options={sources.map((source) => ({
              value: source.id,
              label: `${source.projectTitle} / ${source.filename} (${source.questionCount})`,
            }))}
            onChange={(sourceFileId) => setFilters((current) => ({ ...current, sourceFileId }))}
          />
          <Button onClick={() => setFilters({ status: reviewMode ? 'generated' : undefined })}>重置筛选</Button>
        </Space>
      </Card>

      <Table<QuestionListItem>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={questions}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
        title={() => selectedIds.length ? <Space><Text>已选择 {selectedIds.length} 道题</Text><Button onClick={async () => { await bulkQuestionAction(selectedIds.map(Number), 'approve'); setSelectedIds([]); await loadQuestions(); }}>批量批准</Button><Button danger onClick={async () => { await bulkQuestionAction(selectedIds.map(Number), 'archive'); setSelectedIds([]); await loadQuestions(); }}>批量归档</Button></Space> : null}
        scroll={{ x: 1150 }}
        locale={{ emptyText: <Empty description={reviewMode ? '没有待审核题目' : '题库暂无题目'} /> }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 道题` }}
        expandable={{
          expandedRowRender: (record) => (
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="完整题干"><div style={{ whiteSpace: 'pre-wrap' }}>{record.stem}</div></Descriptions.Item>
              <Descriptions.Item label="选项">
                {record.options?.length ? record.options.join('；') : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="参考答案">
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.answerKey, null, 2) || '未设置'}</pre>
              </Descriptions.Item>
              <Descriptions.Item label="解析">{record.analysis || '未设置'}</Descriptions.Item>
            </Descriptions>
          ),
        }}
      />
    </div>
  );
};

export default QuestionBank;
