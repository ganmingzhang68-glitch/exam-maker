import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { EditOutlined, PlusOutlined, StopOutlined, TeamOutlined } from '@ant-design/icons';
import type { CourseDetail, TeachingClass, TeachingClassStatus } from '@exam-maker/shared';
import { listCourses } from '../services/course';
import { archiveTeachingClass, createTeachingClass, listTeachingClasses, updateTeachingClass, type TeachingClassInput } from '../services/teachingClass';

const { Title, Text } = Typography;
function errorText(error: unknown) { return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? '操作失败'; }

const TeachingClassList: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialCourseId = Number(params.get('courseId')) || undefined;
  const [classes, setClasses] = useState<TeachingClass[]>([]);
  const [courses, setCourses] = useState<CourseDetail[]>([]);
  const [courseId, setCourseId] = useState<number | undefined>(initialCourseId);
  const [status, setStatus] = useState<TeachingClassStatus | undefined>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TeachingClass | null>(null);
  const [form] = Form.useForm<TeachingClassInput>();

  const load = async () => {
    setLoading(true);
    try { setClasses(await listTeachingClasses({ courseId, status, search: search || undefined })); }
    catch (error) { message.error(errorText(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { listCourses({ status: 'active' }).then(setCourses).catch(() => message.error('加载课程失败')); }, []);
  useEffect(() => { void load(); }, [courseId, status]);

  const showForm = (item?: TeachingClass) => {
    setEditing(item ?? null);
    form.setFieldsValue(item ? { courseId: item.courseId, name: item.name, semester: item.semester, status: item.status } : { courseId, status: 'active' });
    setOpen(true);
  };
  const save = async () => {
    const values = await form.validateFields();
    try {
      if (editing) await updateTeachingClass(editing.id, { name: values.name, semester: values.semester, status: values.status });
      else await createTeachingClass(values);
      message.success(editing ? '班级已更新' : '班级已创建'); setOpen(false); form.resetFields(); await load();
    } catch (error) { message.error(errorText(error)); }
  };
  const archive = (item: TeachingClass) => Modal.confirm({
    title: `归档班级“${item.name}”？`, content: '成员关系和历史数据都会保留。', okText: '归档', okButtonProps: { danger: true }, cancelText: '取消',
    onOk: async () => { try { await archiveTeachingClass(item.id); message.success('班级已归档'); await load(); } catch (error) { message.error(errorText(error)); } },
  });

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><div><Title level={3} style={{ margin: 0 }}>班级管理</Title><Text type="secondary">班级通过 Enrollment 关联学生，不复制学生账号。</Text></div><Button type="primary" icon={<PlusOutlined />} disabled={!courses.length} onClick={() => showForm()}>创建班级</Button></div>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select allowClear placeholder="全部课程" value={courseId} onChange={setCourseId} style={{ width: 220 }} options={courses.map((item) => ({ value: item.id, label: item.name }))} />
      <Select allowClear placeholder="全部状态" value={status} onChange={setStatus} style={{ width: 140 }} options={[{ value: 'active', label: '进行中' }, { value: 'archived', label: '已归档' }]} />
      <Input.Search allowClear placeholder="搜索班级" value={search} onChange={(event) => setSearch(event.target.value)} onSearch={() => load()} style={{ width: 260 }} />
    </Space>
    <Table<TeachingClass> rowKey="id" loading={loading} dataSource={classes} onRow={(item) => ({ onClick: () => navigate(`/classes/${item.id}`), style: { cursor: 'pointer' } })} columns={[
      { title: '班级', dataIndex: 'name', render: (value) => <Space><TeamOutlined />{value}</Space> },
      { title: '课程', dataIndex: 'courseName' }, { title: '学期', dataIndex: 'semester', render: (value) => value || '-' },
      { title: '学生', dataIndex: 'studentCount', render: (value) => `${value} 人` },
      { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'active' ? 'green' : 'orange'}>{value === 'active' ? '进行中' : '已归档'}</Tag> },
      { title: '操作', key: 'actions', render: (_, item) => <Space onClick={(event) => event.stopPropagation()}><Button icon={<EditOutlined />} onClick={() => showForm(item)}>编辑</Button><Button danger disabled={item.status === 'archived'} icon={<StopOutlined />} onClick={() => archive(item)}>归档</Button></Space> },
    ]} />
    <Modal title={editing ? '编辑班级' : '创建班级'} open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={save} okText="保存" cancelText="取消">
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}><Select disabled={Boolean(editing)} options={courses.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="semester" label="学期"><Input maxLength={100} /></Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={[{ value: 'active', label: '进行中' }, { value: 'archived', label: '已归档' }]} /></Form.Item>
      </Form>
    </Modal>
  </div>;
};

export default TeachingClassList;
