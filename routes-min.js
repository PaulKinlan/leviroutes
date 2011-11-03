/*
 Copyright 2011 Paul Kinlan 

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0
 
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/var routes=function(){var a=[],b=this;this.parseRoute=function(a){return this.parseGroups=function(a){var b=new RegExp(":([^/.\\\\]+)","g"),c=""+a,d={},e=null,f=0;while(e=b.exec(a))d[e[1]]=f++,c=c.replace(e[0],"([^/.\\\\]+)");return c+="$",{groups:d,regexp:new RegExp(c)}},this.parseGroups(a)};var c=function(b,c){var d=null;for(var e=0;d=a[e];e++){var f=d.regex.regexp.exec(b);if(!!f==0)continue;var g={};for(var h in d.regex.groups){var i=d.regex.groups[h];g[h]=f[i+1]}var j={};if(c&&c.target instanceof HTMLFormElement){var k=c.target,l=k.length,m;for(var n=0;m=k[n];n++)!m.name||(j[m.name]=m.value)}return d.callback({url:b,params:g,values:j,e:c}),!0}return!1};this.get=function(b,c){a.push({regex:this.parseRoute(b),callback:c,method:"get"})},this.post=function(b,c){a.push({regex:this.parseRoute(b),callback:c,method:"post"})},this.test=function(a){c(a)},this.getRoutes=function(){return a};var d=function(){var a=!1,d=!1,e=!1;if(!!window.history&&!!window.history.pushState){var f=history.__proto__.pushState;history.__proto__.pushState=function(a,b,c){f.apply(history,arguments);var d=document.createEvent("Event");d.initEvent("statechanged",!1,!1),d.state=a,window.dispatchEvent(d);return}}b.run=function(){a||(c(document.location.pathname),a=!0)},window.addEventListener("submit",function(a){return a.target.method=="post"&&c(a.target.action,a)?(a.preventDefault(),!1):!0}),window.addEventListener("popstate",function(a){if(e){e=!1,d=!1;return}c(document.location.pathname),d=!0},!1),window.addEventListener("load",function(b){a||(c(document.location.pathname),a=!0),d=!0,e=!0},!1),window.addEventListener("hashchange",function(a){if(d){d=!1,e=!1;return}c(document.location.pathname)},!1)};d()}