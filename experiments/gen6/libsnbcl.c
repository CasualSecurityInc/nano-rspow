/* Experimental, non-conformant OpenCL subset for the checkout's pow_kernel.
 * Handles have real ICD dispatch pointers and checked, reference-counted lives.
 * All queue operations complete synchronously under the driver mutex. */
#define _GNU_SOURCE
#define CL_TARGET_OPENCL_VERSION 300
#define CL_USE_DEPRECATED_OPENCL_1_1_APIS
#define CL_USE_DEPRECATED_OPENCL_1_2_APIS
#include <CL/cl.h>
#include <CL/cl_icd.h>
#include <CL/cl_ext.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "snb-engine-api.h"
#include "powcl_blob.h"

static const cl_icd_dispatch dispatch;
struct _cl_platform_id { const cl_icd_dispatch *dispatch; };
struct _cl_device_id { const cl_icd_dispatch *dispatch; };
static struct _cl_platform_id platform = { &dispatch };
static struct _cl_device_id device = { &dispatch };
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static snb_engine *engine;
static bool attempted;
static bool debug;
static bool verbose;
static uint64_t enqueue_count, gpu_count, cpu_count;
#define LOG(...) do { if (debug) fprintf(stderr,"snbcl: " __VA_ARGS__); } while (0)
#define BEGIN() pthread_mutex_lock(&mutex)
#define END(x) do { cl_int end_rc=(x); pthread_mutex_unlock(&mutex); return end_rc; } while (0)

enum kind { CTX, QUEUE, PROGRAM, KERNEL, MEMORY, EVENT };
struct object {
    const cl_icd_dispatch *dispatch; /* Required first field of every ICD handle. */
    struct object *next, *ctx, *parent;
    enum kind kind;
    cl_uint refs;
    void *data;
    size_t size;
    bool owned;
    cl_mem_flags flags;
    char *source;
    size_t source_len;
    cl_build_status built;
    cl_command_queue_properties properties;
    uint64_t args[6];
    struct object *result, *flag;
    unsigned args_set;
    cl_command_type command;
    cl_ulong start, end;
};
static struct object *objects;
static struct object *lookup(const void *handle, enum kind kind)
{
    for (struct object *o=objects; o; o=o->next)
        if (o==handle && o->kind==kind) return o;
    return NULL;
}
static struct object *make(enum kind kind, struct object *ctx, struct object *parent)
{
    struct object *o=calloc(1,sizeof *o);
    if (!o) return NULL;
    o->dispatch=&dispatch; o->kind=kind; o->refs=1; o->ctx=ctx; o->parent=parent;
    if (ctx) ++ctx->refs;
    if (parent) ++parent->refs;
    o->next=objects; objects=o; o->built=CL_BUILD_NONE;
    return o;
}
static void drop(struct object *o)
{
    if (--o->refs) return;
    struct object **p=&objects;
    while (*p && *p!=o) p=&(*p)->next;
    if (*p) *p=o->next;
    struct object *ctx=o->ctx, *parent=o->parent;
    if (o->owned) free(o->data);
    free(o->source); free(o);
    if (parent) drop(parent);
    if (ctx) drop(ctx);
}
static cl_int reply(size_t need, const void *src, size_t size, void *dst, size_t *returned)
{
    if (dst && size<need) return CL_INVALID_VALUE;
    if (dst && need) memcpy(dst,src,need);
    if (returned) *returned=need;
    return CL_SUCCESS;
}
#define STR(s) return reply(strlen(s)+1,s,size,value,returned)
#define VAL(type, expression) do { type info_value=(expression); return reply(sizeof info_value,&info_value,size,value,returned); } while (0)
static bool available(void)
{
    if (!attempted) {
        attempted=true; engine=snb_engine_open(NULL,16);
        LOG("engine %s%s\n",engine ? "ready" : "unavailable: ",engine ? "" : snb_engine_error());
    }
    return engine!=NULL;
}
static cl_ulong timestamp(void)
{
    struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t);
    return (cl_ulong)t.tv_sec*1000000000u+t.tv_nsec;
}
static cl_int wait_list(struct object *ctx, cl_uint n, const cl_event *list)
{
    if ((!n && list) || (n && !list)) return CL_INVALID_EVENT_WAIT_LIST;
    for (cl_uint i=0; i<n; ++i) {
        struct object *e=lookup(list[i],EVENT);
        if (!e) return CL_INVALID_EVENT_WAIT_LIST;
        if (e->ctx!=ctx) return CL_INVALID_CONTEXT;
    }
    return CL_SUCCESS;
}
static cl_int event_out(struct object *q, cl_event *out, cl_command_type command, cl_ulong start)
{
    if (!out) return CL_SUCCESS;
    struct object *e=make(EVENT,q->ctx,q);
    if (!e) return CL_OUT_OF_HOST_MEMORY;
    e->command=command; e->start=start; e->end=timestamp(); *out=(cl_event)e;
    return CL_SUCCESS;
}

cl_int clGetPlatformIDs(cl_uint n, cl_platform_id *out, cl_uint *count)
{
    BEGIN();
    if ((!out && !count) || (out && !n)) END(CL_INVALID_VALUE);
    if (!available()) { if (count) *count=0; END(CL_PLATFORM_NOT_FOUND_KHR); }
    if (count) *count=1;
    if (out) out[0]=&platform;
    LOG("platform snbcl selected\n"); END(CL_SUCCESS);
}
cl_int clIcdGetPlatformIDsKHR(cl_uint n, cl_platform_id *out, cl_uint *count)
{ return clGetPlatformIDs(n,out,count); }
cl_int clGetPlatformInfo(cl_platform_id p, cl_platform_info key, size_t size, void *value, size_t *returned)
{
    if (p!=&platform) return CL_INVALID_PLATFORM;
    switch (key) {
    case CL_PLATFORM_PROFILE: STR("FULL_PROFILE");
    case CL_PLATFORM_VERSION: STR("OpenCL 1.2 snbcl (pow_kernel subset; non-conformant)");
    case CL_PLATFORM_NAME: STR("snbcl single-kernel Gen6 driver");
    case CL_PLATFORM_VENDOR: STR("Route C experimental driver");
    case CL_PLATFORM_EXTENSIONS: STR("cl_khr_icd");
    case CL_PLATFORM_ICD_SUFFIX_KHR: STR("SNB");
    default: LOG("unsupported platform query 0x%x\n",key); return CL_INVALID_VALUE;
    }
}
cl_int clGetDeviceIDs(cl_platform_id p, cl_device_type type, cl_uint n, cl_device_id *out, cl_uint *count)
{
    BEGIN();
    if (p!=&platform) END(CL_INVALID_PLATFORM);
    if ((!out && !count) || (out && !n)) END(CL_INVALID_VALUE);
    if (!(type&(CL_DEVICE_TYPE_GPU|CL_DEVICE_TYPE_DEFAULT))) END(CL_DEVICE_NOT_FOUND);
    if (!available()) END(CL_DEVICE_NOT_AVAILABLE);
    if (count) *count=1;
    if (out) out[0]=&device;
    END(CL_SUCCESS);
}
cl_int clGetDeviceInfo(cl_device_id d, cl_device_info key, size_t size, void *value, size_t *returned)
{
    if (d!=&device) return CL_INVALID_DEVICE;
    switch (key) {
    case CL_DEVICE_TYPE: VAL(cl_device_type,CL_DEVICE_TYPE_GPU);
    case CL_DEVICE_VENDOR_ID: VAL(cl_uint,0x8086);
    case CL_DEVICE_MAX_COMPUTE_UNITS: VAL(cl_uint,12);
    case CL_DEVICE_MAX_WORK_ITEM_DIMENSIONS: VAL(cl_uint,1);
    case CL_DEVICE_MAX_WORK_ITEM_SIZES: { size_t dims[1]={64}; return reply(sizeof dims,dims,size,value,returned); }
    case CL_DEVICE_MAX_WORK_GROUP_SIZE: VAL(size_t,64);
    case CL_DEVICE_MAX_CLOCK_FREQUENCY: VAL(cl_uint,1300);
    case CL_DEVICE_ADDRESS_BITS: VAL(cl_uint,64);
    case CL_DEVICE_MAX_MEM_ALLOC_SIZE: VAL(cl_ulong,256u<<20);
    case CL_DEVICE_GLOBAL_MEM_SIZE: VAL(cl_ulong,512u<<20);
    case CL_DEVICE_MAX_PARAMETER_SIZE: VAL(size_t,256);
    case CL_DEVICE_MAX_CONSTANT_ARGS: VAL(cl_uint,8);
    case CL_DEVICE_MAX_CONSTANT_BUFFER_SIZE: VAL(cl_ulong,65536);
    case CL_DEVICE_LOCAL_MEM_TYPE: VAL(cl_device_local_mem_type,CL_GLOBAL);
    case CL_DEVICE_LOCAL_MEM_SIZE: VAL(cl_ulong,0);
    case CL_DEVICE_IMAGE_SUPPORT: case CL_DEVICE_ERROR_CORRECTION_SUPPORT:
    case CL_DEVICE_LINKER_AVAILABLE: VAL(cl_bool,CL_FALSE);
    case CL_DEVICE_AVAILABLE: case CL_DEVICE_COMPILER_AVAILABLE:
    case CL_DEVICE_ENDIAN_LITTLE: VAL(cl_bool,CL_TRUE);
    case CL_DEVICE_EXECUTION_CAPABILITIES: VAL(cl_device_exec_capabilities,CL_EXEC_KERNEL);
    case CL_DEVICE_QUEUE_PROPERTIES: VAL(cl_command_queue_properties,CL_QUEUE_PROFILING_ENABLE);
    case CL_DEVICE_PLATFORM: VAL(cl_platform_id,&platform);
    case CL_DEVICE_REFERENCE_COUNT: VAL(cl_uint,1);
    case CL_DEVICE_PARENT_DEVICE: VAL(cl_device_id,NULL);
    case CL_DEVICE_PROFILING_TIMER_RESOLUTION: VAL(size_t,1);
    case CL_DEVICE_MEM_BASE_ADDR_ALIGN: VAL(cl_uint,128);
    case CL_DEVICE_MIN_DATA_TYPE_ALIGN_SIZE: VAL(cl_uint,16);
    case CL_DEVICE_PREFERRED_VECTOR_WIDTH_CHAR: case CL_DEVICE_PREFERRED_VECTOR_WIDTH_SHORT:
    case CL_DEVICE_PREFERRED_VECTOR_WIDTH_INT: case CL_DEVICE_PREFERRED_VECTOR_WIDTH_LONG:
    case CL_DEVICE_PREFERRED_VECTOR_WIDTH_FLOAT: VAL(cl_uint,1);
    case CL_DEVICE_PREFERRED_VECTOR_WIDTH_DOUBLE: VAL(cl_uint,0);
    case CL_DEVICE_SINGLE_FP_CONFIG: VAL(cl_device_fp_config,0);
    case CL_DEVICE_NAME: STR("Intel HD Graphics 3000 (snbcl pow_kernel)");
    case CL_DEVICE_VENDOR: STR("Intel GPU / Route C snbcl driver");
    case CL_DEVICE_VERSION: STR("OpenCL 1.2 snbcl (pow_kernel only)");
    case CL_DEVICE_OPENCL_C_VERSION: STR("OpenCL C 1.2 (source-match pow_kernel only)");
    case CL_DRIVER_VERSION: STR("Route C M5");
    case CL_DEVICE_PROFILE: STR("FULL_PROFILE");
    case CL_DEVICE_EXTENSIONS: case CL_DEVICE_BUILT_IN_KERNELS: STR("");
    default: LOG("unsupported device query 0x%x\n",key); return CL_INVALID_VALUE;
    }
}
cl_int clRetainDevice(cl_device_id d) { return d==&device ? CL_SUCCESS : CL_INVALID_DEVICE; }
cl_int clReleaseDevice(cl_device_id d) { return d==&device ? CL_SUCCESS : CL_INVALID_DEVICE; }

cl_context clCreateContext(const cl_context_properties *props, cl_uint n, const cl_device_id *devices,
    void (CL_CALLBACK *callback)(const char *,const void *,size_t,void *), void *user, cl_int *err)
{
    BEGIN(); cl_int rc=CL_SUCCESS; struct object *o=NULL;
    if (n!=1 || !devices || devices[0]!=&device || (user && !callback)) rc=CL_INVALID_VALUE;
    if (props) for (size_t i=0; props[i] && rc==CL_SUCCESS; i+=2)
        if (props[i]!=CL_CONTEXT_PLATFORM || props[i+1]!=(cl_context_properties)&platform) rc=CL_INVALID_PROPERTY;
    if (!rc && !available()) rc=CL_DEVICE_NOT_AVAILABLE;
    if (!rc && !(o=make(CTX,NULL,NULL))) rc=CL_OUT_OF_HOST_MEMORY;
    if (err) *err=rc;
    pthread_mutex_unlock(&mutex); return (cl_context)o;
}
cl_context clCreateContextFromType(const cl_context_properties *props, cl_device_type type,
    void (CL_CALLBACK *cb)(const char *,const void *,size_t,void *), void *user, cl_int *err)
{
    if (!(type&(CL_DEVICE_TYPE_GPU|CL_DEVICE_TYPE_DEFAULT))) { if(err)*err=CL_DEVICE_NOT_FOUND; return NULL; }
    cl_device_id d=&device; return clCreateContext(props,1,&d,cb,user,err);
}
#define REFS(Name,Type,Tag,Error) \
cl_int clRetain##Name(Type handle) { BEGIN(); struct object *o=lookup(handle,Tag); if(!o) END(Error); ++o->refs; END(CL_SUCCESS); } \
cl_int clRelease##Name(Type handle) { BEGIN(); struct object *o=lookup(handle,Tag); if(!o) END(Error); drop(o); END(CL_SUCCESS); }
REFS(Context,cl_context,CTX,CL_INVALID_CONTEXT)
REFS(CommandQueue,cl_command_queue,QUEUE,CL_INVALID_COMMAND_QUEUE)
REFS(Program,cl_program,PROGRAM,CL_INVALID_PROGRAM)
REFS(Kernel,cl_kernel,KERNEL,CL_INVALID_KERNEL)
REFS(MemObject,cl_mem,MEMORY,CL_INVALID_MEM_OBJECT)
REFS(Event,cl_event,EVENT,CL_INVALID_EVENT)

static cl_int context_info(struct object *o, cl_context_info key, size_t size, void *value,size_t *returned)
{
    switch(key) {
    case CL_CONTEXT_REFERENCE_COUNT: VAL(cl_uint,o->refs);
    case CL_CONTEXT_NUM_DEVICES: VAL(cl_uint,1);
    case CL_CONTEXT_DEVICES: VAL(cl_device_id,&device);
    case CL_CONTEXT_PROPERTIES: { cl_context_properties p[]={CL_CONTEXT_PLATFORM,(cl_context_properties)&platform,0}; return reply(sizeof p,p,size,value,returned); }
    default: LOG("unsupported context query 0x%x\n",key); return CL_INVALID_VALUE;
    }
}
cl_int clGetContextInfo(cl_context c,cl_context_info key,size_t size,void *value,size_t *returned)
{ BEGIN(); struct object *o=lookup(c,CTX); if(!o) END(CL_INVALID_CONTEXT); cl_int rc=context_info(o,key,size,value,returned); END(rc); }
cl_command_queue clCreateCommandQueue(cl_context c,cl_device_id d,cl_command_queue_properties props,cl_int *err)
{
    BEGIN(); struct object *ctx=lookup(c,CTX), *o=NULL; cl_int rc=CL_SUCCESS;
    if(!ctx) rc=CL_INVALID_CONTEXT;
    else if(d!=&device) rc=CL_INVALID_DEVICE;
    else if(props&~CL_QUEUE_PROFILING_ENABLE) rc=CL_INVALID_QUEUE_PROPERTIES;
    else if(!(o=make(QUEUE,ctx,NULL))) rc=CL_OUT_OF_HOST_MEMORY;
    if(o) o->properties=props;
    if(err)*err=rc;
    pthread_mutex_unlock(&mutex); return (cl_command_queue)o;
}
cl_command_queue clCreateCommandQueueWithProperties(cl_context c,cl_device_id d,const cl_queue_properties *p,cl_int *err)
{
    cl_command_queue_properties flags=0;
    if(p) for(size_t i=0;p[i];i+=2) {
        if(p[i]!=CL_QUEUE_PROPERTIES) {if(err)*err=CL_INVALID_QUEUE_PROPERTIES;return NULL;}
        flags=(cl_command_queue_properties)p[i+1];
    }
    return clCreateCommandQueue(c,d,flags,err);
}
static cl_int queue_info(struct object *o,cl_command_queue_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_QUEUE_CONTEXT: VAL(cl_context,(cl_context)o->ctx);
    case CL_QUEUE_DEVICE: VAL(cl_device_id,&device);
    case CL_QUEUE_REFERENCE_COUNT: VAL(cl_uint,o->refs);
    case CL_QUEUE_PROPERTIES: VAL(cl_command_queue_properties,o->properties);
    default: LOG("unsupported queue query 0x%x\n",key); return CL_INVALID_VALUE;
    }
}
cl_int clGetCommandQueueInfo(cl_command_queue q,cl_command_queue_info key,size_t size,void *value,size_t *returned)
{ BEGIN();struct object *o=lookup(q,QUEUE);if(!o)END(CL_INVALID_COMMAND_QUEUE);cl_int rc=queue_info(o,key,size,value,returned);END(rc); }

cl_mem clCreateBuffer(cl_context c,cl_mem_flags flags,size_t bytes,void *host,cl_int *err)
{
    BEGIN(); struct object *ctx=lookup(c,CTX),*o=NULL;cl_int rc=CL_SUCCESS;
    cl_mem_flags access=flags&(CL_MEM_READ_WRITE|CL_MEM_WRITE_ONLY|CL_MEM_READ_ONLY);
    cl_mem_flags known=CL_MEM_READ_WRITE|CL_MEM_WRITE_ONLY|CL_MEM_READ_ONLY|CL_MEM_USE_HOST_PTR|CL_MEM_ALLOC_HOST_PTR|CL_MEM_COPY_HOST_PTR;
    if(!ctx)rc=CL_INVALID_CONTEXT;
    else if(!bytes || bytes>(256u<<20))rc=CL_INVALID_BUFFER_SIZE;
    else if((flags&~known) || (access && (access&(access-1))) ||
            ((flags&CL_MEM_USE_HOST_PTR) && (flags&(CL_MEM_COPY_HOST_PTR|CL_MEM_ALLOC_HOST_PTR))))rc=CL_INVALID_VALUE;
    else if((host && !(flags&(CL_MEM_USE_HOST_PTR|CL_MEM_COPY_HOST_PTR))) ||
            (!host && (flags&(CL_MEM_USE_HOST_PTR|CL_MEM_COPY_HOST_PTR))))rc=CL_INVALID_HOST_PTR;
    else if(!(o=make(MEMORY,ctx,NULL)))rc=CL_OUT_OF_HOST_MEMORY;
    if(o) {
        o->flags=flags ? flags : CL_MEM_READ_WRITE;o->size=bytes;o->owned=!(flags&CL_MEM_USE_HOST_PTR);
        o->data=o->owned ? calloc(1,bytes) : host;
        if(!o->data){drop(o);o=NULL;rc=CL_MEM_OBJECT_ALLOCATION_FAILURE;}
        else if(flags&CL_MEM_COPY_HOST_PTR)memcpy(o->data,host,bytes);
    }
    if(err)*err=rc;
    pthread_mutex_unlock(&mutex);return (cl_mem)o;
}
static cl_int mem_info(struct object *o,cl_mem_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_MEM_TYPE: VAL(cl_mem_object_type,CL_MEM_OBJECT_BUFFER);
    case CL_MEM_FLAGS: VAL(cl_mem_flags,o->flags);
    case CL_MEM_SIZE: VAL(size_t,o->size);
    case CL_MEM_HOST_PTR: VAL(void *,o->owned ? NULL : o->data);
    case CL_MEM_MAP_COUNT: VAL(cl_uint,0);
    case CL_MEM_REFERENCE_COUNT: VAL(cl_uint,o->refs);
    case CL_MEM_CONTEXT: VAL(cl_context,(cl_context)o->ctx);
    case CL_MEM_ASSOCIATED_MEMOBJECT: VAL(cl_mem,NULL);
    case CL_MEM_OFFSET: VAL(size_t,0);
    default: LOG("unsupported memory query 0x%x\n",key); return CL_INVALID_VALUE;
    }
}
cl_int clGetMemObjectInfo(cl_mem m,cl_mem_info key,size_t size,void *value,size_t *returned)
{ BEGIN();struct object *o=lookup(m,MEMORY);if(!o)END(CL_INVALID_MEM_OBJECT);cl_int rc=mem_info(o,key,size,value,returned);END(rc); }
static cl_int transfer(cl_command_queue q,cl_mem m,size_t off,size_t bytes,void *host,
                      cl_uint n,const cl_event *wait,cl_event *ev,bool write)
{
    BEGIN(); struct object *queue=lookup(q,QUEUE),*mem=lookup(m,MEMORY);
    if(!queue)END(CL_INVALID_COMMAND_QUEUE);
    if(!mem)END(CL_INVALID_MEM_OBJECT);
    if(mem->ctx!=queue->ctx)END(CL_INVALID_CONTEXT);
    if(!host || !bytes || off>mem->size || bytes>mem->size-off)END(CL_INVALID_VALUE);
    cl_int rc=wait_list(queue->ctx,n,wait);if(rc)END(rc);
    cl_ulong start=timestamp();
    if(write)memcpy((char *)mem->data+off,host,bytes);else memcpy(host,(char *)mem->data+off,bytes);
    rc=event_out(queue,ev,write ? CL_COMMAND_WRITE_BUFFER : CL_COMMAND_READ_BUFFER,start);END(rc);
}
cl_int clEnqueueReadBuffer(cl_command_queue q,cl_mem m,cl_bool blocking,size_t off,size_t n,void *p,cl_uint nw,const cl_event *w,cl_event *e)
{ if(blocking!=CL_TRUE && blocking!=CL_FALSE)return CL_INVALID_VALUE;return transfer(q,m,off,n,p,nw,w,e,false); }
cl_int clEnqueueWriteBuffer(cl_command_queue q,cl_mem m,cl_bool blocking,size_t off,size_t n,const void *p,cl_uint nw,const cl_event *w,cl_event *e)
{ if(blocking!=CL_TRUE && blocking!=CL_FALSE)return CL_INVALID_VALUE;return transfer(q,m,off,n,(void *)p,nw,w,e,true); }
cl_int clEnqueueFillBuffer(cl_command_queue q,cl_mem m,const void *pattern,size_t ps,size_t off,size_t n,cl_uint nw,const cl_event *w,cl_event *ev)
{
    BEGIN();struct object *queue=lookup(q,QUEUE),*mem=lookup(m,MEMORY);
    if(!queue)END(CL_INVALID_COMMAND_QUEUE);
    if(!mem)END(CL_INVALID_MEM_OBJECT);
    if(mem->ctx!=queue->ctx)END(CL_INVALID_CONTEXT);
    if(!pattern || !ps || ps>128 || (ps&(ps-1)) || off%ps || n%ps || !n || off>mem->size || n>mem->size-off)END(CL_INVALID_VALUE);
    cl_int rc=wait_list(queue->ctx,nw,w);if(rc)END(rc);
    cl_ulong start=timestamp();for(size_t i=0;i<n;i+=ps)memcpy((char *)mem->data+off+i,pattern,ps);
    rc=event_out(queue,ev,CL_COMMAND_FILL_BUFFER,start);END(rc);
}

cl_program clCreateProgramWithSource(cl_context c,cl_uint n,const char **strings,const size_t *lengths,cl_int *err)
{
    BEGIN();struct object *ctx=lookup(c,CTX),*o=NULL;cl_int rc=CL_SUCCESS;size_t total=0;
    if(!ctx)rc=CL_INVALID_CONTEXT;else if(!n || !strings)rc=CL_INVALID_VALUE;
    for(cl_uint i=0;i<n && !rc;++i) {
        if(!strings[i]){rc=CL_INVALID_VALUE;break;}
        size_t len=lengths && lengths[i] ? lengths[i] : strlen(strings[i]);
        if(len>(1u<<20)-total){rc=CL_OUT_OF_HOST_MEMORY;break;}total+=len;
    }
    if(!rc && !(o=make(PROGRAM,ctx,NULL)))rc=CL_OUT_OF_HOST_MEMORY;
    if(o) {
        o->source=malloc(total+1);o->source_len=total;
        if(!o->source){drop(o);o=NULL;rc=CL_OUT_OF_HOST_MEMORY;}
        else {size_t pos=0;for(cl_uint i=0;i<n;++i){size_t len=lengths&&lengths[i]?lengths[i]:strlen(strings[i]);memcpy(o->source+pos,strings[i],len);pos+=len;}o->source[total]=0;}
    }
    if(err)*err=rc;
    pthread_mutex_unlock(&mutex);return (cl_program)o;
}
static bool matches(struct object *p)
{
    unsigned char *normalized=malloc(p->source_len ? p->source_len : 1);
    if(!normalized)return false;
    size_t n=0;
    for(size_t i=0;i<p->source_len;++i) {
        if(p->source[i]=='\r' && i+1<p->source_len && p->source[i+1]=='\n')continue;
        normalized[n++]=(unsigned char)p->source[i];
    }
    /* ocl 0.19.7 ProgramBuilder prepends exactly two newline source strings
     * (get_includes and get_includes_eof). No other source edits are accepted. */
    size_t skip=(n==powcl_length+2 && normalized[0]=='\n' && normalized[1]=='\n') ? 2 : 0;
    bool match=n==powcl_length+skip && !memcmp(normalized+skip,powcl_source,powcl_length);
    free(normalized);return match;
}

cl_int clBuildProgram(cl_program handle,cl_uint n,const cl_device_id *d,const char *options,
                     void (CL_CALLBACK *cb)(cl_program,void *),void *user)
{
    BEGIN();struct object *p=lookup(handle,PROGRAM);if(!p)END(CL_INVALID_PROGRAM);
    if((n && !d) || (!n && d) || (user && !cb))END(CL_INVALID_VALUE);
    for(cl_uint i=0;i<n;++i)if(d[i]!=&device)END(CL_INVALID_DEVICE);
    if(options && *options && strcmp(options,"-cl-kernel-arg-info") && strcmp(options,"-cl-std=CL1.2"))END(CL_INVALID_BUILD_OPTIONS);
    p->built=matches(p) ? CL_BUILD_SUCCESS : CL_BUILD_ERROR;
    cl_int rc=p->built==CL_BUILD_SUCCESS ? CL_SUCCESS : CL_BUILD_PROGRAM_FAILURE;
    LOG("build source=%s (pow.cl only)\n",rc ? "MISMATCH" : "MATCH");
    pthread_mutex_unlock(&mutex);if(cb)cb(handle,user);return rc;
}
static cl_int program_info(struct object *p,cl_program_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_PROGRAM_REFERENCE_COUNT: VAL(cl_uint,p->refs);
    case CL_PROGRAM_CONTEXT: VAL(cl_context,(cl_context)p->ctx);
    case CL_PROGRAM_NUM_DEVICES: VAL(cl_uint,1);
    case CL_PROGRAM_DEVICES: VAL(cl_device_id,&device);
    case CL_PROGRAM_SOURCE: return reply(p->source_len+1,p->source,size,value,returned);
    case CL_PROGRAM_NUM_KERNELS: VAL(size_t,p->built==CL_BUILD_SUCCESS?1:0);
    case CL_PROGRAM_KERNEL_NAMES: STR(p->built==CL_BUILD_SUCCESS ? "pow_kernel" : "");
    default: LOG("unsupported program query 0x%x\n",key);return CL_INVALID_VALUE;
    }
}
cl_int clGetProgramInfo(cl_program p,cl_program_info key,size_t size,void *value,size_t *returned)
{BEGIN();struct object *o=lookup(p,PROGRAM);if(!o)END(CL_INVALID_PROGRAM);cl_int rc=program_info(o,key,size,value,returned);END(rc);}
static cl_int build_info(struct object *p,cl_program_build_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_PROGRAM_BUILD_STATUS: VAL(cl_build_status,p->built);
    case CL_PROGRAM_BUILD_LOG: STR(p->built==CL_BUILD_ERROR ? "snbcl: source mismatch; only the embedded checkout pow.cl is supported" : "snbcl: single-kernel source-match backend");
    case CL_PROGRAM_BUILD_OPTIONS: STR("");
    case CL_PROGRAM_BINARY_TYPE: VAL(cl_program_binary_type,p->built==CL_BUILD_SUCCESS ? CL_PROGRAM_BINARY_TYPE_EXECUTABLE : CL_PROGRAM_BINARY_TYPE_NONE);
    default: LOG("unsupported build query 0x%x\n",key);return CL_INVALID_VALUE;
    }
}
cl_int clGetProgramBuildInfo(cl_program p,cl_device_id d,cl_program_build_info key,size_t size,void *value,size_t *returned)
{BEGIN();struct object *o=lookup(p,PROGRAM);if(!o)END(CL_INVALID_PROGRAM);if(d!=&device)END(CL_INVALID_DEVICE);cl_int rc=build_info(o,key,size,value,returned);END(rc);}
cl_kernel clCreateKernel(cl_program p,const char *name,cl_int *err)
{
    BEGIN();struct object *prog=lookup(p,PROGRAM),*o=NULL;cl_int rc=CL_SUCCESS;
    if(!prog)rc=CL_INVALID_PROGRAM;else if(prog->built!=CL_BUILD_SUCCESS)rc=CL_INVALID_PROGRAM_EXECUTABLE;
    else if(!name || strcmp(name,"pow_kernel"))rc=CL_INVALID_KERNEL_NAME;
    else if(!(o=make(KERNEL,prog->ctx,prog)))rc=CL_OUT_OF_HOST_MEMORY;
    if(err)*err=rc;
    pthread_mutex_unlock(&mutex);return (cl_kernel)o;
}
cl_int clSetKernelArg(cl_kernel handle,cl_uint i,size_t size,const void *value)
{
    BEGIN();struct object *k=lookup(handle,KERNEL);if(!k)END(CL_INVALID_KERNEL);
    if(i>=8)END(CL_INVALID_ARG_INDEX);
    if(!value)END(CL_INVALID_ARG_VALUE);
    if(i<6) {if(size!=sizeof(cl_ulong))END(CL_INVALID_ARG_SIZE);memcpy(&k->args[i],value,sizeof(cl_ulong));}
    else {
        if(size!=sizeof(cl_mem))END(CL_INVALID_ARG_SIZE);
        cl_mem mem;memcpy(&mem,value,sizeof mem);struct object *m=lookup(mem,MEMORY);
        if(!m)END(CL_INVALID_MEM_OBJECT);
        if(m->ctx!=k->ctx)END(CL_INVALID_MEM_OBJECT);
        if(i==6)k->result=m;else k->flag=m;
    }
    k->args_set|=1u<<i;END(CL_SUCCESS);
}
static cl_int kernel_info(struct object *k,cl_kernel_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_KERNEL_FUNCTION_NAME: STR("pow_kernel");
    case CL_KERNEL_NUM_ARGS: VAL(cl_uint,8);
    case CL_KERNEL_REFERENCE_COUNT: VAL(cl_uint,k->refs);
    case CL_KERNEL_CONTEXT: VAL(cl_context,(cl_context)k->ctx);
    case CL_KERNEL_PROGRAM: VAL(cl_program,(cl_program)k->parent);
    case CL_KERNEL_ATTRIBUTES: STR("");
    default: LOG("unsupported kernel query 0x%x\n",key);return CL_INVALID_VALUE;
    }
}
cl_int clGetKernelInfo(cl_kernel h,cl_kernel_info key,size_t size,void *value,size_t *returned)
{BEGIN();struct object *k=lookup(h,KERNEL);if(!k)END(CL_INVALID_KERNEL);cl_int rc=kernel_info(k,key,size,value,returned);END(rc);}
static cl_int group_info(cl_kernel_work_group_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_KERNEL_WORK_GROUP_SIZE: VAL(size_t,64);
    case CL_KERNEL_COMPILE_WORK_GROUP_SIZE: {size_t d[3]={0};return reply(sizeof d,d,size,value,returned);}
    case CL_KERNEL_LOCAL_MEM_SIZE: case CL_KERNEL_PRIVATE_MEM_SIZE: VAL(cl_ulong,0);
    case CL_KERNEL_PREFERRED_WORK_GROUP_SIZE_MULTIPLE: VAL(size_t,16);
    default: LOG("unsupported work-group query 0x%x\n",key);return CL_INVALID_VALUE;
    }
}
cl_int clGetKernelWorkGroupInfo(cl_kernel h,cl_device_id d,cl_kernel_work_group_info key,size_t size,void *value,size_t *returned)
{BEGIN();if(!lookup(h,KERNEL))END(CL_INVALID_KERNEL);if(d && d!=&device)END(CL_INVALID_DEVICE);cl_int rc=group_info(key,size,value,returned);END(rc);}
cl_int clGetKernelArgInfo(cl_kernel h,cl_uint i,cl_kernel_arg_info key,size_t size,void *value,size_t *returned)
{
    BEGIN();if(!lookup(h,KERNEL))END(CL_INVALID_KERNEL);if(i>=8)END(CL_INVALID_ARG_INDEX);
    cl_int rc=CL_INVALID_VALUE;
    static const char *names[]={"hash0","hash1","hash2","hash3","base_nonce","threshold","result_nonce","result_found"};
    if(key==CL_KERNEL_ARG_TYPE_NAME){const char *s=i<6?"ulong":i==6?"ulong*":"uint*";rc=reply(strlen(s)+1,s,size,value,returned);}
    else if(key==CL_KERNEL_ARG_NAME)rc=reply(strlen(names[i])+1,names[i],size,value,returned);
    else if(key==CL_KERNEL_ARG_ADDRESS_QUALIFIER){cl_kernel_arg_address_qualifier v=i<6?CL_KERNEL_ARG_ADDRESS_PRIVATE:CL_KERNEL_ARG_ADDRESS_GLOBAL;rc=reply(sizeof v,&v,size,value,returned);}
    else if(key==CL_KERNEL_ARG_ACCESS_QUALIFIER){cl_kernel_arg_access_qualifier v=CL_KERNEL_ARG_ACCESS_NONE;rc=reply(sizeof v,&v,size,value,returned);}
    else if(key==CL_KERNEL_ARG_TYPE_QUALIFIER){cl_kernel_arg_type_qualifier v=i==7?CL_KERNEL_ARG_TYPE_VOLATILE:CL_KERNEL_ARG_TYPE_NONE;rc=reply(sizeof v,&v,size,value,returned);}
    END(rc);
}
cl_int clEnqueueNDRangeKernel(cl_command_queue q,cl_kernel handle,cl_uint dim,const size_t *offset,
    const size_t *global,const size_t *local,cl_uint nw,const cl_event *w,cl_event *ev)
{
    BEGIN();struct object *queue=lookup(q,QUEUE),*k=lookup(handle,KERNEL);
    if(!queue)END(CL_INVALID_COMMAND_QUEUE);
    if(!k)END(CL_INVALID_KERNEL);
    if(queue->ctx!=k->ctx)END(CL_INVALID_CONTEXT);
    if(dim!=1)END(CL_INVALID_WORK_DIMENSION);
    if(!global || !global[0])END(CL_INVALID_GLOBAL_WORK_SIZE);
    size_t off=offset?offset[0]:0;
    if(off>UINT32_MAX || global[0]>(UINT64_C(1)<<32)-off)END(CL_INVALID_GLOBAL_OFFSET);
    if(local && (!local[0] || local[0]>64 || global[0]%local[0]))END(CL_INVALID_WORK_GROUP_SIZE);
    if(k->args_set!=255)END(CL_INVALID_KERNEL_ARGS);
    if(!lookup(k->result,MEMORY) || !lookup(k->flag,MEMORY))END(CL_INVALID_MEM_OBJECT);
    if(k->result->size<8 || k->flag->size<4 || k->result==k->flag)END(CL_INVALID_ARG_VALUE);
    cl_int rc=wait_list(queue->ctx,nw,w);if(rc)END(rc);
    if(!available())END(CL_DEVICE_NOT_AVAILABLE);
    cl_ulong start=timestamp();cl_uint flag;memcpy(&flag,k->flag->data,4);
    if(!flag) {
        uint8_t root[32];for(unsigned i=0;i<32;++i)root[i]=(uint8_t)(k->args[i/8]>>(8*(i%8)));
        struct snb_result r;uint64_t base=k->args[4]+off;
        int hit=snb_engine_search(engine,root,base,global[0],k->args[5],&r);
        if(hit<0){LOG("engine ERROR: %s\n",snb_engine_error());END(CL_OUT_OF_RESOURCES);}
        ++enqueue_count;gpu_count+=r.gpu_hashes;cpu_count+=r.cpu_hashes;
        if(hit){memcpy(k->result->data,&r.nonce,8);flag=1;memcpy(k->flag->data,&flag,4);}
        if(hit || verbose)LOG("NDRange base=0x%016llx count=%zu gpu=%llu cpu=%llu %s\n",
            (unsigned long long)base,global[0],(unsigned long long)r.gpu_hashes,(unsigned long long)r.cpu_hashes,hit?"HIT CPU-verified":"miss");
    }
    rc=event_out(queue,ev,CL_COMMAND_NDRANGE_KERNEL,start);END(rc);
}

cl_int clFinish(cl_command_queue q)
{BEGIN();if(!lookup(q,QUEUE))END(CL_INVALID_COMMAND_QUEUE);END(CL_SUCCESS);}
cl_int clFlush(cl_command_queue q) {return clFinish(q);}
cl_int clWaitForEvents(cl_uint n,const cl_event *list)
{
    BEGIN();if(!n || !list)END(CL_INVALID_VALUE);
    struct object *first=lookup(list[0],EVENT);if(!first)END(CL_INVALID_EVENT);
    cl_int rc=wait_list(first->ctx,n,list);END(rc);
}
static cl_int event_info(struct object *e,cl_event_info key,size_t size,void *value,size_t *returned)
{
    switch(key) {
    case CL_EVENT_COMMAND_EXECUTION_STATUS: VAL(cl_int,CL_COMPLETE);
    case CL_EVENT_COMMAND_QUEUE: VAL(cl_command_queue,(cl_command_queue)e->parent);
    case CL_EVENT_CONTEXT: VAL(cl_context,(cl_context)e->ctx);
    case CL_EVENT_REFERENCE_COUNT: VAL(cl_uint,e->refs);
    case CL_EVENT_COMMAND_TYPE: VAL(cl_command_type,e->command);
    default: LOG("unsupported event query 0x%x\n",key);return CL_INVALID_VALUE;
    }
}
cl_int clGetEventInfo(cl_event h,cl_event_info key,size_t size,void *value,size_t *returned)
{BEGIN();struct object *e=lookup(h,EVENT);if(!e)END(CL_INVALID_EVENT);cl_int rc=event_info(e,key,size,value,returned);END(rc);}
cl_int clGetEventProfilingInfo(cl_event h,cl_profiling_info key,size_t size,void *value,size_t *returned)
{
    BEGIN();struct object *e=lookup(h,EVENT);if(!e)END(CL_INVALID_EVENT);
    if(!(e->parent->properties&CL_QUEUE_PROFILING_ENABLE))END(CL_PROFILING_INFO_NOT_AVAILABLE);
    cl_ulong stamp;
    if(key==CL_PROFILING_COMMAND_QUEUED || key==CL_PROFILING_COMMAND_SUBMIT || key==CL_PROFILING_COMMAND_START)stamp=e->start;
    else if(key==CL_PROFILING_COMMAND_END)stamp=e->end;else END(CL_INVALID_VALUE);
    cl_int rc=reply(sizeof stamp,&stamp,size,value,returned);END(rc);
}
cl_int clSetEventCallback(cl_event h,cl_int type,void (CL_CALLBACK *cb)(cl_event,cl_int,void *),void *user)
{
    BEGIN();struct object *e=lookup(h,EVENT);if(!e)END(CL_INVALID_EVENT);
    if(!cb || (type!=CL_SUBMITTED && type!=CL_RUNNING && type!=CL_COMPLETE))END(CL_INVALID_VALUE);
    ++e->refs;pthread_mutex_unlock(&mutex);cb(h,CL_COMPLETE,user);
    BEGIN();drop(e);END(CL_SUCCESS);
}
void *clGetExtensionFunctionAddress(const char *name)
{
    if(!name)return NULL;
    if(!strcmp(name,"clIcdGetPlatformIDsKHR"))return (void *)&clIcdGetPlatformIDsKHR;
    if(!strcmp(name,"clGetPlatformInfo"))return (void *)&clGetPlatformInfo;
    return NULL;
}
void *clGetExtensionFunctionAddressForPlatform(cl_platform_id p,const char *name)
{return p==&platform ? clGetExtensionFunctionAddress(name) : NULL;}

static const cl_icd_dispatch dispatch={
#define D(name) .name=name
    D(clGetPlatformIDs),D(clGetPlatformInfo),D(clGetDeviceIDs),D(clGetDeviceInfo),
    D(clCreateContext),D(clCreateContextFromType),D(clRetainContext),D(clReleaseContext),D(clGetContextInfo),
    D(clCreateCommandQueue),D(clCreateCommandQueueWithProperties),D(clRetainCommandQueue),D(clReleaseCommandQueue),D(clGetCommandQueueInfo),
    D(clCreateBuffer),D(clRetainMemObject),D(clReleaseMemObject),D(clGetMemObjectInfo),
    D(clCreateProgramWithSource),D(clRetainProgram),D(clReleaseProgram),D(clGetProgramInfo),D(clBuildProgram),D(clGetProgramBuildInfo),
    D(clCreateKernel),D(clRetainKernel),D(clReleaseKernel),D(clSetKernelArg),D(clGetKernelInfo),D(clGetKernelWorkGroupInfo),D(clGetKernelArgInfo),
    D(clEnqueueReadBuffer),D(clEnqueueWriteBuffer),D(clEnqueueFillBuffer),D(clEnqueueNDRangeKernel),
    D(clFinish),D(clFlush),D(clWaitForEvents),D(clRetainEvent),D(clReleaseEvent),D(clGetEventInfo),D(clGetEventProfilingInfo),D(clSetEventCallback),
    D(clGetExtensionFunctionAddress),D(clGetExtensionFunctionAddressForPlatform),D(clRetainDevice),D(clReleaseDevice)
#undef D
};
__attribute__((constructor)) static void initialize(void)
{const char *d=getenv("SNBCL_DEBUG");debug=d && strcmp(d,"0");verbose=d && !strcmp(d,"2");LOG("loaded pid=%ld; restricted pow_kernel ICD\n",(long)getpid());}
__attribute__((destructor)) static void shutdown_driver(void)
{
    LOG("summary enqueues=%llu GPU_hashes=%llu CPU_tail_hashes=%llu\n",(unsigned long long)enqueue_count,(unsigned long long)gpu_count,(unsigned long long)cpu_count);
    if(objects)LOG("live application objects remain at process exit\n");
    snb_engine_close(engine);
}
